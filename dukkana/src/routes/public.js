import { hashPassword, verifyPassword } from '../security.js';
import { isUniqueViolation } from '../db.js';
import {
  DAY, SLUG_RE, cleanText, formatMoney, normalizePhone, normalizeSlug, validateSlug, whatsappNumber,
} from '../util.js';
import { landingPage, loginPage, signupPage, storePage } from '../views/public.js';
import { simplePage } from '../views/layout.js';
import {
  COUPON_RE, OrderError, couponLabel, normalizeCouponCode, priceOrder,
} from '../pricing.js';


export function registerPublicRoutes(app, ctx) {
  const { db, config, now, services, ah, limiters, cookieOpts } = ctx;

  const validRef = (value) => {
    const slug = normalizeSlug(cleanText(value, 40));
    return SLUG_RE.test(slug) && services.merchantBySlug(slug) ? slug : '';
  };

  app.get('/', (req, res) => {
    res.send(landingPage({
      config,
      refSlug: validRef(req.query.ref),
      demoSlug: services.merchantBySlug('demo') ? 'demo' : null,
    }));
  });

  app.get('/signup', (req, res) => {
    if (req.merchant) return res.redirect('/dashboard');
    res.send(signupPage({ csrf: req.csrfToken, refSlug: validRef(req.query.ref) }));
  });

  app.post('/signup', ah(async (req, res) => {
    const b = req.body;
    const values = {
      store_name: cleanText(b.store_name, 60),
      slug: normalizeSlug(cleanText(b.slug, 40)),
      phone: cleanText(b.phone, 30),
      whatsapp: cleanText(b.whatsapp, 30),
    };
    const refSlug = validRef(b.ref);
    const render = (status, errors) =>
      res.status(status).send(signupPage({ csrf: req.csrfToken, values, errors, refSlug }));

    if (!limiters.signup.hit(req.ip)) {
      return render(429, ['محاولات كتير من نفس الشبكة. استنى شوية وجرّب تاني.']);
    }

    const errors = [];
    if (values.store_name.length < 2) errors.push('اكتب اسم المحل (حرفين على الأقل).');
    const slugError = validateSlug(values.slug);
    if (slugError) errors.push(slugError);
    const phone = normalizePhone(values.phone);
    if (!phone) errors.push('رقم الموبايل لازم يكون رقم مصري صحيح زي 01012345678.');
    const whatsapp = values.whatsapp ? normalizePhone(values.whatsapp) : phone;
    if (values.whatsapp && !whatsapp) errors.push('رقم الواتساب لازم يكون رقم مصري صحيح.');
    const password = String(b.password ?? '');
    if (password.length < 8) errors.push('كلمة السر لازم تكون 8 حروف أو أرقام على الأقل.');
    if (password.length > 200) errors.push('كلمة السر طويلة زيادة.');
    if (errors.length) return render(400, errors);

    if (db.get('SELECT 1 FROM merchants WHERE phone = ?', phone)) {
      return render(400, ['الرقم ده متسجل قبل كده. ادخل من صفحة تسجيل الدخول.']);
    }
    if (services.merchantBySlug(values.slug)) {
      return render(400, ['رابط المتجر ده مستخدم، اختار رابط تاني.']);
    }

    const referrer = refSlug ? services.merchantBySlug(refSlug) : null;
    const passwordHash = await hashPassword(password);
    let id;
    try {
      const r = db.run(
        `INSERT INTO merchants (phone, password_hash, store_name, slug, whatsapp, plan_expires_at, referred_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        phone, passwordHash, values.store_name, values.slug, whatsapp,
        config.trialDays > 0 ? now() + config.trialDays * DAY : null,
        referrer ? referrer.id : null, now(),
      );
      id = Number(r.lastInsertRowid);
    } catch (err) {
      if (isUniqueViolation(err)) return render(400, ['الرقم أو رابط المتجر اتسجل قبل كده.']);
      throw err;
    }

    const { token, ttl } = services.createSession({ merchantId: id });
    res.cookie('sid', token, cookieOpts(ttl));
    res.redirect(303, '/dashboard?msg=welcome');
  }));

  app.get('/login', (req, res) => {
    if (req.merchant) return res.redirect('/dashboard');
    res.send(loginPage({ csrf: req.csrfToken, config }));
  });

  app.post('/login', ah(async (req, res) => {
    const raw = cleanText(req.body.phone, 30);
    const phone = normalizePhone(raw);
    const render = (status, errors) =>
      res.status(status).send(loginPage({ csrf: req.csrfToken, values: { phone: raw }, errors, config }));

    const accountKey = `${req.ip}|${phone || raw}`;
    if (!limiters.loginIp.hit(req.ip) || !limiters.loginAccount.hit(accountKey)) {
      return render(429, ['محاولات كتير. استنى ربع ساعة وجرّب تاني.']);
    }
    const merchant = phone ? db.get('SELECT * FROM merchants WHERE phone = ?', phone) : null;
    const ok = merchant ? await verifyPassword(String(req.body.password ?? ''), merchant.password_hash) : false;
    if (!ok) return render(400, ['رقم الموبايل أو كلمة السر غلط.']);

    limiters.loginAccount.reset(accountKey);
    const { token, ttl } = services.createSession({ merchantId: merchant.id });
    res.cookie('sid', token, cookieOpts(ttl));
    res.redirect(303, '/dashboard');
  }));

  app.post('/logout', (req, res) => {
    services.deleteSession(req.cookies.sid);
    res.clearCookie('sid', { path: '/' });
    res.redirect(303, '/');
  });

  const storeNotFound = (res) =>
    res.status(404).send(simplePage({ title: 'المتجر مش موجود', message: 'اتأكد من اللينك، أو اعمل متجرك انت مجاناً.', linkHref: '/signup', linkText: 'اعمل متجرك', status: '404' }));

  app.get('/s/:slug', (req, res) => {
    const merchant = services.merchantBySlug(normalizeSlug(req.params.slug));
    if (!merchant) return storeNotFound(res);
    const products = services.visibleProducts(merchant);
    const base = ctx.baseUrl(req);
    const withImage = merchant.logo ? { image: merchant.logo } : products.find((p) => p.image);
    res.send(storePage({
      merchant,
      products,
      showBadge: !services.isPro(merchant),
      storeUrl: `${base}/s/${merchant.slug}`,
      ogImage: withImage ? `${base}/uploads/${withImage.image}` : null,
      coupons: services.isPro(merchant) && services.hasActiveCoupons(merchant.id),
    }));
  });

  /** Shared by /quote and /order: find the store and price the cart. */
  const loadCheckout = (req) => {
    const merchant = services.merchantBySlug(normalizeSlug(req.params.slug));
    if (!merchant) throw new OrderError(404, 'المتجر مش موجود.');
    if (!merchant.is_open) throw new OrderError(409, 'المحل مقفول دلوقتي ومش بياخد طلبات. جرّب تاني بعدين.');
    const b = req.body && typeof req.body === 'object' ? req.body : {};
    const code = normalizeCouponCode(cleanText(b.coupon, 40));
    let coupon = null;
    if (code) {
      coupon = COUPON_RE.test(code) && services.isPro(merchant) ? services.couponByCode(merchant.id, code) : null;
      if (!coupon) throw new OrderError(400, 'الكوبون ده مش موجود.');
    }
    const fulfillment = b.fulfillment === 'pickup' ? 'pickup' : 'delivery';
    const priced = priceOrder({
      merchant, products: services.visibleProducts(merchant), items: b.items, fulfillment, coupon, now: now(),
    });
    return { merchant, b, coupon, priced };
  };

  const sendError = (res, err) => {
    if (err instanceof OrderError) return res.status(err.status).json({ error: err.message });
    throw err;
  };

  // Live price check (used when the customer applies a coupon).
  app.post('/s/:slug/quote', (req, res) => {
    if (!limiters.quote.hit(req.ip)) return res.status(429).json({ error: 'محاولات كتير. استنى شوية.' });
    try {
      const { coupon, priced } = loadCheckout(req);
      res.json({
        subtotal: priced.subtotal,
        discount: priced.discount,
        deliveryFee: priced.deliveryFee,
        total: priced.total,
        coupon: coupon ? { code: coupon.code, label: couponLabel(coupon) } : null,
      });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post('/s/:slug/order', (req, res) => {
    if (!limiters.order.hit(req.ip)) return res.status(429).json({ error: 'طلبات كتير في وقت قصير. استنى شوية وجرّب تاني.' });
    let checkout;
    try {
      checkout = loadCheckout(req);
    } catch (err) {
      return sendError(res, err);
    }
    const { merchant, b, coupon, priced } = checkout;
    const fail = (status, error) => res.status(status).json({ error });

    const name = cleanText(b.name, 60);
    const phone = normalizePhone(b.phone);
    const address = cleanText(b.address, 300, { multiline: true });
    const notes = cleanText(b.notes, 500, { multiline: true });
    if (name.length < 2) return fail(400, 'اكتب اسمك.');
    if (!phone) return fail(400, 'اكتب رقم موبايل مصري صحيح زي 01012345678.');
    if (priced.fulfillment === 'delivery' && address.length < 5) return fail(400, 'اكتب العنوان بالتفصيل.');

    let orderId;
    try {
      orderId = db.tx(() => {
        if (coupon) {
          // Atomic: never exceed max uses even with simultaneous orders.
          const r = db.run(
            'UPDATE coupons SET uses = uses + 1 WHERE id = ? AND active = 1 AND (max_uses IS NULL OR uses < max_uses)',
            coupon.id,
          );
          if (r.changes === 0) throw new OrderError(409, 'الكوبون ده خلص.');
        }
        const r = db.run(
          `INSERT INTO orders (merchant_id, customer_name, customer_phone, address, notes, items, subtotal, delivery_fee,
             discount, coupon_code, fulfillment, total, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          merchant.id, name, phone, address, notes, JSON.stringify(priced.lines), priced.subtotal, priced.deliveryFee,
          priced.discount, coupon ? coupon.code : '', priced.fulfillment, priced.total, now(),
        );
        return Number(r.lastInsertRowid);
      });
    } catch (err) {
      return sendError(res, err);
    }

    const pickup = priced.fulfillment === 'pickup';
    const message = [
      `🛒 *طلب جديد #${orderId}* من ${merchant.store_name}`,
      '',
      ...priced.lines.map((l) => `• ${l.qty} × ${l.name} = ${formatMoney(l.price * l.qty)}`),
      '',
      `المنتجات: ${formatMoney(priced.subtotal)}`,
      priced.discount > 0 ? `الخصم (كوبون ${coupon.code}): -${formatMoney(priced.discount)}` : null,
      priced.deliveryFee > 0 ? `التوصيل: ${formatMoney(priced.deliveryFee)}` : null,
      `*الإجمالي: ${formatMoney(priced.total)}*`,
      '',
      pickup ? '🏪 *استلام من المحل*' : '🚚 *توصيل*',
      `👤 الاسم: ${name}`,
      `📞 الموبايل: ${phone}`,
      !pickup || address ? `📍 العنوان: ${address}` : null,
      notes ? `📝 ملاحظات: ${notes}` : null,
    ].filter((line) => line !== null).join('\n');

    res.status(201).json({
      ok: true,
      orderId,
      total: priced.total,
      whatsappUrl: `https://wa.me/${whatsappNumber(merchant.whatsapp)}?text=${encodeURIComponent(message)}`,
    });
  });
}
