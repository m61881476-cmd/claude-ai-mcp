import { hashPassword, verifyPassword } from '../security.js';
import { isUniqueViolation } from '../db.js';
import {
  ACCENTS, cleanText, daysLeft, normalizeDigits, normalizePhone, normalizeSlug, parsePrice, validateSlug,
} from '../util.js';
import {
  billingPage, couponsPage, homePage, ordersPage, productFormPage, productsPage, settingsPage,
} from '../views/dashboard.js';
import { COUPON_RE, normalizeCouponCode } from '../pricing.js';

const MAX_DELIVERY_FEE = 1000 * 100; // 1000 EGP in piasters
const MAX_MIN_ORDER = 10000 * 100;

/** CSV with every cell quoted; cells that look like formulas are neutralized for Excel. */
export function toCsv(rows) {
  return rows.map((row) => row.map((cell) => {
    let v = String(cell ?? '');
    if (/^[=+\-@\t\r]/.test(v) && !/^-?\d+(\.\d+)?$/.test(v)) v = `'${v}`;
    return `"${v.replace(/"/g, '""')}"`;
  }).join(',')).join('\r\n');
}

const cairoFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
});
function cairoDateTime(ms) {
  const p = Object.fromEntries(cairoFmt.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour === '24' ? '00' : p.hour}:${p.minute}`;
}

function cairoOffsetMs(ms) {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: 'Africa/Cairo', timeZoneName: 'shortOffset' })
    .formatToParts(new Date(ms)).find((x) => x.type === 'timeZoneName').value; // e.g. "GMT+2"
  const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(name);
  if (!m) return 0;
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] || 0)) * 60000;
}

/** "2026-06-30" → the instant that day ends in Cairo (midnight after it). Null if invalid. */
export function endOfCairoDay(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalizeDigits(dateStr));
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
  const midnightUtc = Date.UTC(y, mo - 1, d + 1);
  return midnightUtc - cairoOffsetMs(midnightUtc - 3 * 60 * 60 * 1000);
}
const SOCIAL_HOSTS = {
  facebook: ['facebook.com', 'fb.com', 'fb.me'],
  instagram: ['instagram.com'],
  tiktok: ['tiktok.com'],
};

/** Accept only real https links to the given platform; returns null otherwise. */
export function socialUrl(input, platform) {
  let url;
  try {
    url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const host = url.hostname.toLowerCase();
  if (!SOCIAL_HOSTS[platform].some((h) => host === h || host.endsWith(`.${h}`))) return null;
  url.protocol = 'https:';
  url.username = '';
  url.password = '';
  return url.toString();
}
const ORDER_STATUSES = new Set(['new', 'done', 'cancelled']);

export function registerDashboardRoutes(app, ctx) {
  const { db, config, now, services, ah, imageUpload, removeUpload, cookieOpts, limiters } = ctx;

  const requireMerchant = (req, res, next) => {
    if (!req.merchant) return res.redirect(303, '/login');
    next();
  };
  app.use('/dashboard', requireMerchant);

  const msgOf = (req) => (typeof req.query.msg === 'string' ? req.query.msg : '');
  const categoriesOf = (req) =>
    db.all(
      "SELECT category FROM products WHERE merchant_id = ? AND category != '' GROUP BY category ORDER BY MIN(id)",
      req.merchant.id,
    ).map((r) => r.category);
  const ownProduct = (req) =>
    db.get('SELECT * FROM products WHERE id = ? AND merchant_id = ?', Number(req.params.id), req.merchant.id) || null;

  app.get('/dashboard', (req, res) => {
    const m = req.merchant;
    const pro = services.isPro(m);
    res.send(homePage({
      csrf: req.csrfToken,
      merchant: m,
      msg: msgOf(req),
      storeUrl: `${ctx.baseUrl(req)}/s/${m.slug}`,
      pro,
      daysLeft: daysLeft(m, now()),
      productCount: services.productCount(m.id),
      stats: services.merchantStats(m),
      recentOrders: db.all('SELECT * FROM orders WHERE merchant_id = ? ORDER BY id DESC LIMIT 5', m.id),
      config,
    }));
  });

  // ---- Products -----------------------------------------------------------

  const renderProducts = (req, res, status = 200, errors = []) =>
    res.status(status).send(productsPage({
      csrf: req.csrfToken,
      products: services.allProducts(req.merchant.id),
      msg: msgOf(req),
      pro: services.isPro(req.merchant),
      config,
      errors,
    }));

  const limitError = () =>
    `وصلت لحد ${config.freeProductLimit} منتجات في الباقة المجانية. اشترك في الباقة الاحترافية عشان تضيف منتجات من غير حد.`;

  app.get('/dashboard/products', (req, res) => renderProducts(req, res));

  app.get('/dashboard/products/new', (req, res) => {
    if (!services.canAddProduct(req.merchant)) return renderProducts(req, res, 403, [limitError()]);
    res.send(productFormPage({ csrf: req.csrfToken, categories: categoriesOf(req) }));
  });

  /** Validate product fields. Returns { values, errors, data }. */
  const readProduct = (req) => {
    const values = {
      name: cleanText(req.body.name, 80),
      price: cleanText(req.body.price, 20),
      description: cleanText(req.body.description, 500, { multiline: true }),
      category: cleanText(req.body.category, 40),
      compare_price: cleanText(req.body.compare_price, 20),
    };
    const errors = [];
    if (!values.name) errors.push('اكتب اسم المنتج.');
    const price = parsePrice(values.price);
    if (price === null) errors.push('السعر لازم يكون رقم، زي 120 أو 99.50.');
    else if (price <= 0) errors.push('السعر لازم يكون أكبر من صفر.');
    let comparePrice = null;
    if (values.compare_price) {
      comparePrice = parsePrice(values.compare_price);
      if (comparePrice === null) errors.push('السعر قبل الخصم لازم يكون رقم.');
      else if (price !== null && comparePrice <= price) errors.push('السعر قبل الخصم لازم يكون أكبر من السعر الحالي.');
    }
    if (req.uploadError) errors.push(req.uploadError);
    return {
      values,
      errors,
      data: { name: values.name, price, description: values.description, category: values.category, comparePrice },
    };
  };

  app.post('/dashboard/products/new', imageUpload, (req, res) => {
    const { values, errors, data } = readProduct(req);
    if (!services.canAddProduct(req.merchant)) errors.unshift(limitError());
    if (errors.length) {
      if (req.file) removeUpload(req.file.filename);
      return res.status(400).send(productFormPage({ csrf: req.csrfToken, values, errors, categories: categoriesOf(req) }));
    }
    db.run(
      'INSERT INTO products (merchant_id, name, price, compare_price, description, category, image, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      req.merchant.id, data.name, data.price, data.comparePrice, data.description, data.category, req.file ? req.file.filename : null, now(),
    );
    res.redirect(303, '/dashboard/products?msg=added');
  });

  app.get('/dashboard/products/:id(\\d+)/edit', (req, res, next) => {
    const product = ownProduct(req);
    if (!product) return next();
    res.send(productFormPage({ csrf: req.csrfToken, product, categories: categoriesOf(req) }));
  });

  app.post('/dashboard/products/:id(\\d+)/edit', imageUpload, (req, res, next) => {
    const product = ownProduct(req);
    if (!product) {
      if (req.file) removeUpload(req.file.filename);
      return next();
    }
    const { values, errors, data } = readProduct(req);
    if (errors.length) {
      if (req.file) removeUpload(req.file.filename);
      return res.status(400).send(productFormPage({ csrf: req.csrfToken, product, values, errors, categories: categoriesOf(req) }));
    }
    let image = product.image;
    if (req.file) image = req.file.filename;
    else if (req.body.remove_image === '1') image = null;
    db.run(
      'UPDATE products SET name = ?, price = ?, compare_price = ?, description = ?, category = ?, image = ? WHERE id = ? AND merchant_id = ?',
      data.name, data.price, data.comparePrice, data.description, data.category, image, product.id, req.merchant.id,
    );
    if (product.image && product.image !== image) removeUpload(product.image);
    res.redirect(303, '/dashboard/products?msg=updated');
  });

  app.post('/dashboard/products/:id(\\d+)/toggle', (req, res, next) => {
    const product = ownProduct(req);
    if (!product) return next();
    db.run('UPDATE products SET available = ? WHERE id = ?', product.available ? 0 : 1, product.id);
    res.redirect(303, '/dashboard/products?msg=updated');
  });

  app.post('/dashboard/products/:id(\\d+)/delete', (req, res, next) => {
    const product = ownProduct(req);
    if (!product) return next();
    db.run('DELETE FROM products WHERE id = ?', product.id);
    removeUpload(product.image);
    res.redirect(303, '/dashboard/products?msg=deleted');
  });

  // ---- Orders ---------------------------------------------------------------

  app.get('/dashboard/orders', (req, res) => {
    const filter = ORDER_STATUSES.has(req.query.status) ? req.query.status : 'all';
    const orders = filter === 'all'
      ? db.all('SELECT * FROM orders WHERE merchant_id = ? ORDER BY id DESC LIMIT 200', req.merchant.id)
      : db.all('SELECT * FROM orders WHERE merchant_id = ? AND status = ? ORDER BY id DESC LIMIT 200', req.merchant.id, filter);
    res.send(ordersPage({ csrf: req.csrfToken, orders, msg: msgOf(req), filter, pro: services.isPro(req.merchant) }));
  });

  app.post('/dashboard/orders/:id(\\d+)/status', (req, res, next) => {
    const status = String(req.body.status ?? '');
    if (!ORDER_STATUSES.has(status)) return res.redirect(303, '/dashboard/orders');
    const r = db.run('UPDATE orders SET status = ? WHERE id = ? AND merchant_id = ?', status, Number(req.params.id), req.merchant.id);
    if (r.changes === 0) return next();
    res.redirect(303, '/dashboard/orders?msg=status');
  });

  // ---- Settings -------------------------------------------------------------

  app.get('/dashboard/settings', (req, res) => {
    res.send(settingsPage({ csrf: req.csrfToken, merchant: req.merchant, msg: msgOf(req) }));
  });

  app.post('/dashboard/settings', (req, res) => {
    const b = req.body;
    const values = {
      store_name: cleanText(b.store_name, 60),
      slug: normalizeSlug(cleanText(b.slug, 40)),
      whatsapp: cleanText(b.whatsapp, 30),
      description: cleanText(b.description, 300, { multiline: true }),
      accent: String(b.accent ?? ''),
      delivery_fee: cleanText(b.delivery_fee, 20) || '0',
      min_order: cleanText(b.min_order, 20) || '0',
      pickup_enabled: b.pickup_enabled === '1',
      facebook: cleanText(b.facebook, 200),
      instagram: cleanText(b.instagram, 200),
      tiktok: cleanText(b.tiktok, 200),
    };
    const errors = [];
    if (values.store_name.length < 2) errors.push('اكتب اسم المحل (حرفين على الأقل).');
    const slugError = validateSlug(values.slug);
    if (slugError) errors.push(slugError);
    else if (values.slug !== req.merchant.slug && services.merchantBySlug(values.slug)) {
      errors.push('رابط المتجر ده مستخدم، اختار رابط تاني.');
    }
    const whatsapp = normalizePhone(values.whatsapp);
    if (!whatsapp) errors.push('رقم الواتساب لازم يكون رقم مصري صحيح زي 01012345678.');
    const fee = parsePrice(values.delivery_fee);
    if (fee === null || fee > MAX_DELIVERY_FEE) errors.push('مصاريف التوصيل لازم تكون رقم من 0 لـ 1000 جنيه.');
    const minOrder = parsePrice(values.min_order);
    if (minOrder === null || minOrder > MAX_MIN_ORDER) errors.push('أقل قيمة للطلب لازم تكون رقم من 0 لـ 10000 جنيه.');
    const social = {};
    for (const [key, label] of [['facebook', 'فيسبوك'], ['instagram', 'إنستجرام'], ['tiktok', 'تيك توك']]) {
      social[key] = values[key] ? socialUrl(values[key], key) : '';
      if (social[key] === null) errors.push(`لينك ${label} مش صحيح. انسخه من التطبيق وحطه كامل (بيبدأ بـ https://).`);
    }
    if (!Object.hasOwn(ACCENTS, values.accent)) values.accent = 'green';

    const render = (status, errs) =>
      res.status(status).send(settingsPage({ csrf: req.csrfToken, merchant: req.merchant, values, errors: errs }));
    if (errors.length) return render(400, errors);
    try {
      db.run(
        `UPDATE merchants SET store_name = ?, slug = ?, whatsapp = ?, description = ?, accent = ?, delivery_fee = ?,
           min_order = ?, pickup_enabled = ?, facebook = ?, instagram = ?, tiktok = ? WHERE id = ?`,
        values.store_name, values.slug, whatsapp, values.description, values.accent, fee,
        minOrder, values.pickup_enabled ? 1 : 0, social.facebook, social.instagram, social.tiktok, req.merchant.id,
      );
    } catch (err) {
      if (isUniqueViolation(err)) return render(400, ['رابط المتجر ده مستخدم، اختار رابط تاني.']);
      throw err;
    }
    res.redirect(303, '/dashboard/settings?msg=saved');
  });

  app.post('/dashboard/settings/logo', imageUpload, (req, res) => {
    const m = req.merchant;
    if (req.uploadError) {
      return res.status(400).send(settingsPage({ csrf: req.csrfToken, merchant: m, errors: [req.uploadError] }));
    }
    let logo = m.logo;
    if (req.file) logo = req.file.filename;
    else if (req.body.remove_logo === '1') logo = null;
    db.run('UPDATE merchants SET logo = ? WHERE id = ?', logo, m.id);
    if (m.logo && m.logo !== logo) removeUpload(m.logo);
    res.redirect(303, '/dashboard/settings?msg=saved');
  });

  app.post('/dashboard/store-status', (req, res) => {
    const open = req.body.open === '1' ? 1 : 0;
    db.run('UPDATE merchants SET is_open = ? WHERE id = ?', open, req.merchant.id);
    res.redirect(303, `/dashboard?msg=${open ? 'opened' : 'closed'}`);
  });

  app.post('/dashboard/password', ah(async (req, res) => {
    const errors = [];
    const ok = await verifyPassword(String(req.body.current ?? ''), req.merchant.password_hash);
    if (!ok) errors.push('كلمة السر الحالية غلط.');
    const password = String(req.body.password ?? '');
    if (password.length < 8 || password.length > 200) errors.push('كلمة السر الجديدة لازم تكون 8 حروف أو أرقام على الأقل.');
    if (errors.length) {
      return res.status(400).send(settingsPage({ csrf: req.csrfToken, merchant: req.merchant, errors }));
    }
    db.run('UPDATE merchants SET password_hash = ? WHERE id = ?', await hashPassword(password), req.merchant.id);
    // Log out every other device, keep this one logged in with a fresh session.
    services.deleteMerchantSessions(req.merchant.id);
    const { token, ttl } = services.createSession({ merchantId: req.merchant.id });
    res.cookie('sid', token, cookieOpts(ttl));
    res.redirect(303, '/dashboard/settings?msg=saved');
  }));

  // ---- Coupons (Pro) --------------------------------------------------------

  const renderCoupons = (req, res, { status = 200, errors = [], values = {} } = {}) =>
    res.status(status).send(couponsPage({
      csrf: req.csrfToken,
      coupons: db.all('SELECT * FROM coupons WHERE merchant_id = ? ORDER BY id DESC', req.merchant.id),
      pro: services.isPro(req.merchant),
      now: now(),
      msg: msgOf(req),
      errors,
      values,
      config,
    }));

  app.get('/dashboard/coupons', (req, res) => renderCoupons(req, res));

  app.post('/dashboard/coupons', (req, res) => {
    const b = req.body;
    const values = {
      code: normalizeCouponCode(cleanText(b.code, 40)),
      kind: b.kind === 'fixed' ? 'fixed' : 'percent',
      value: cleanText(b.value, 20),
      min_subtotal: cleanText(b.min_subtotal, 20),
      max_uses: cleanText(b.max_uses, 10),
      expires: cleanText(b.expires, 10),
    };
    const errors = [];
    if (!services.isPro(req.merchant)) errors.push('الكوبونات متاحة في الباقة الاحترافية بس.');
    if (!COUPON_RE.test(values.code)) errors.push('الكود لازم يكون من 2 لـ 20 حرف أو رقم، من غير مسافات.');
    let value = null;
    if (values.kind === 'percent') {
      const n = Number(normalizeDigits(values.value));
      if (Number.isInteger(n) && n >= 1 && n <= 90) value = n;
      else errors.push('نسبة الخصم لازم تكون رقم صحيح من 1 لـ 90.');
    } else {
      const p = parsePrice(values.value);
      if (p !== null && p > 0 && p <= 100000 * 100) value = p;
      else errors.push('مبلغ الخصم لازم يكون رقم أكبر من صفر.');
    }
    const minSubtotal = values.min_subtotal ? parsePrice(values.min_subtotal) : 0;
    if (minSubtotal === null) errors.push('أقل قيمة طلب للكوبون لازم تكون رقم.');
    let maxUses = null;
    if (values.max_uses) {
      const n = Number(normalizeDigits(values.max_uses));
      if (Number.isInteger(n) && n >= 1 && n <= 100000) maxUses = n;
      else errors.push('عدد مرات الاستخدام لازم يكون رقم صحيح أكبر من صفر.');
    }
    let expiresAt = null;
    if (values.expires) {
      expiresAt = endOfCairoDay(values.expires);
      if (expiresAt === null) errors.push('تاريخ الانتهاء مش صحيح.');
      else if (expiresAt <= now()) errors.push('تاريخ الانتهاء لازم يكون النهارده أو بعد كده.');
    }
    const count = db.get('SELECT COUNT(*) AS n FROM coupons WHERE merchant_id = ?', req.merchant.id).n;
    if (count >= 50) errors.push('وصلت لأقصى عدد كوبونات (50). امسح كوبونات قديمة.');
    if (!errors.length && services.couponByCode(req.merchant.id, values.code)) errors.push('الكود ده موجود قبل كده.');
    if (errors.length) return renderCoupons(req, res, { status: 400, errors, values });

    try {
      db.run(
        `INSERT INTO coupons (merchant_id, code, kind, value, min_subtotal, max_uses, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        req.merchant.id, values.code, values.kind, value, minSubtotal, maxUses, expiresAt, now(),
      );
    } catch (err) {
      if (isUniqueViolation(err)) return renderCoupons(req, res, { status: 400, errors: ['الكود ده موجود قبل كده.'], values });
      throw err;
    }
    res.redirect(303, '/dashboard/coupons?msg=coupon');
  });

  app.post('/dashboard/coupons/:id(\\d+)/toggle', (req, res, next) => {
    const r = db.run('UPDATE coupons SET active = 1 - active WHERE id = ? AND merchant_id = ?', Number(req.params.id), req.merchant.id);
    if (r.changes === 0) return next();
    res.redirect(303, '/dashboard/coupons?msg=updated');
  });

  app.post('/dashboard/coupons/:id(\\d+)/delete', (req, res, next) => {
    const r = db.run('DELETE FROM coupons WHERE id = ? AND merchant_id = ?', Number(req.params.id), req.merchant.id);
    if (r.changes === 0) return next();
    res.redirect(303, '/dashboard/coupons?msg=deleted');
  });

  // ---- Orders export (Pro) ----------------------------------------------------

  app.get('/dashboard/orders.csv', (req, res) => {
    if (!services.isPro(req.merchant)) return res.redirect(303, '/dashboard/billing');
    const orders = db.all('SELECT * FROM orders WHERE merchant_id = ? ORDER BY id', req.merchant.id);
    const STATUS = { new: 'جديد', done: 'اتسلّم', cancelled: 'اتلغى' };
    const rows = [[
      'رقم الطلب', 'التاريخ', 'الاسم', 'الموبايل', 'الاستلام', 'العنوان', 'المنتجات', 'قيمة المنتجات',
      'الخصم', 'الكوبون', 'التوصيل', 'الإجمالي', 'الحالة', 'ملاحظات',
    ]];
    const egp = (p) => (p / 100).toFixed(2);
    for (const o of orders) {
      const items = JSON.parse(o.items).map((it) => `${it.qty} × ${it.name}`).join(' | ');
      rows.push([
        o.id, cairoDateTime(o.created_at), o.customer_name, o.customer_phone,
        o.fulfillment === 'pickup' ? 'استلام من المحل' : 'توصيل', o.address, items, egp(o.subtotal),
        egp(o.discount), o.coupon_code, egp(o.delivery_fee), egp(o.total), STATUS[o.status] || o.status, o.notes,
      ]);
    }
    const day = cairoDateTime(now()).slice(0, 10);
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="orders-${day}.csv"`,
      'Cache-Control': 'no-store',
    });
    res.send('﻿' + toCsv(rows));
  });

  // ---- Billing ----------------------------------------------------------------

  const renderBilling = (req, res, { status = 200, errors = [], values = {} } = {}) => {
    const m = req.merchant;
    res.status(status).send(billingPage({
      csrf: req.csrfToken,
      merchant: m,
      pro: services.isPro(m),
      daysLeft: daysLeft(m, now()),
      config,
      payments: db.all('SELECT * FROM payments WHERE merchant_id = ? ORDER BY id DESC LIMIT 20', m.id),
      referralUrl: `${ctx.baseUrl(req)}/?ref=${m.slug}`,
      referralStats: {
        signups: db.get('SELECT COUNT(*) AS n FROM merchants WHERE referred_by = ?', m.id).n,
        rewards: db.get('SELECT COUNT(*) AS n FROM referral_rewards WHERE referrer_id = ?', m.id).n,
      },
      errors,
      values,
      msg: msgOf(req),
    }));
  };

  app.get('/dashboard/billing', (req, res) => renderBilling(req, res));

  app.post('/dashboard/billing', (req, res) => {
    const b = req.body;
    const values = {
      plan: String(b.plan ?? ''),
      method: String(b.method ?? ''),
      sender: cleanText(b.sender, 60),
      reference: cleanText(b.reference, 60),
    };
    const errors = [];
    const price = services.planPrice(values.plan);
    if (!price) errors.push('اختار الباقة.');
    const methodOk = (values.method === 'vodafone_cash' && config.vodafoneCash) || (values.method === 'instapay' && config.instapay);
    if (!methodOk) errors.push('اختار طريقة الدفع.');
    if (values.sender.length < 3) errors.push('اكتب الرقم أو الحساب اللي حوّلت منه.');
    if (values.reference.length < 3) errors.push('اكتب رقم العملية اللي في رسالة التأكيد.');
    if (db.get("SELECT 1 FROM payments WHERE merchant_id = ? AND status = 'pending'", req.merchant.id)) {
      errors.push('عندك طلب دفع قيد المراجعة بالفعل.');
    }
    if (errors.length === 0 && !limiters.payment.hit(String(req.merchant.id))) {
      errors.push('محاولات كتير. استنى ساعة وجرّب تاني.');
    }
    if (errors.length) return renderBilling(req, res, { status: 400, errors, values });

    db.run(
      'INSERT INTO payments (merchant_id, plan, amount, method, sender, reference, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      req.merchant.id, values.plan, price.amount, values.method, values.sender, values.reference, now(),
    );
    res.redirect(303, '/dashboard/billing?msg=payment');
  });
}
