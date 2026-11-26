import { hashPassword, verifyPassword } from '../security.js';
import { isUniqueViolation } from '../db.js';
import {
  ACCENTS, cleanText, daysLeft, normalizePhone, normalizeSlug, parsePrice, validateSlug,
} from '../util.js';
import {
  billingPage, homePage, ordersPage, productFormPage, productsPage, settingsPage,
} from '../views/dashboard.js';

const MAX_DELIVERY_FEE = 1000 * 100; // 1000 EGP in piasters
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
    };
    const errors = [];
    if (!values.name) errors.push('اكتب اسم المنتج.');
    const price = parsePrice(values.price);
    if (price === null) errors.push('السعر لازم يكون رقم، زي 120 أو 99.50.');
    else if (price <= 0) errors.push('السعر لازم يكون أكبر من صفر.');
    if (req.uploadError) errors.push(req.uploadError);
    return { values, errors, data: { name: values.name, price, description: values.description, category: values.category } };
  };

  app.post('/dashboard/products/new', imageUpload, (req, res) => {
    const { values, errors, data } = readProduct(req);
    if (!services.canAddProduct(req.merchant)) errors.unshift(limitError());
    if (errors.length) {
      if (req.file) removeUpload(req.file.filename);
      return res.status(400).send(productFormPage({ csrf: req.csrfToken, values, errors, categories: categoriesOf(req) }));
    }
    db.run(
      'INSERT INTO products (merchant_id, name, price, description, category, image, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      req.merchant.id, data.name, data.price, data.description, data.category, req.file ? req.file.filename : null, now(),
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
      'UPDATE products SET name = ?, price = ?, description = ?, category = ?, image = ? WHERE id = ? AND merchant_id = ?',
      data.name, data.price, data.description, data.category, image, product.id, req.merchant.id,
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
    res.send(ordersPage({ csrf: req.csrfToken, orders, msg: msgOf(req), filter }));
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
    if (!Object.hasOwn(ACCENTS, values.accent)) values.accent = 'green';

    const render = (status, errs) =>
      res.status(status).send(settingsPage({ csrf: req.csrfToken, merchant: req.merchant, values, errors: errs }));
    if (errors.length) return render(400, errors);
    try {
      db.run(
        'UPDATE merchants SET store_name = ?, slug = ?, whatsapp = ?, description = ?, accent = ?, delivery_fee = ? WHERE id = ?',
        values.store_name, values.slug, whatsapp, values.description, values.accent, fee, req.merchant.id,
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
