import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startApp, signup, DAY, PNG_BYTES } from './helpers.js';

let ctx;
test.before(async () => {
  ctx = await startApp();
});
test.after(async () => {
  await ctx.close();
});

const addProduct = (client, fields, file) =>
  client.postMultipart('/dashboard/products/new', { name: 'منتج', price: '10', ...fields }, file);

test('public pages render with security headers', async () => {
  const c = ctx.client();
  for (const p of ['/', '/signup', '/login']) {
    const r = await c.get(p);
    assert.equal(r.status, 200, p);
    assert.match(r.headers.get('content-security-policy'), /script-src 'self'/);
    assert.equal(r.headers.get('x-frame-options'), 'DENY');
    assert.match(r.text, /<html lang="ar" dir="rtl">/);
  }
  assert.equal((await c.get('/does-not-exist')).status, 404);
  assert.equal((await c.get('/s/missing-store')).status, 404);
});

test('signup validates input', async () => {
  const c = ctx.client();
  await c.get('/signup');
  const r = await c.post('/signup', { store_name: 'x', slug: 'A B', phone: '123', password: 'short' });
  assert.equal(r.status, 400);
  assert.match(r.text, /اسم المحل/);
  assert.match(r.text, /رابط المتجر/);
  assert.match(r.text, /رقم الموبايل/);
  assert.match(r.text, /كلمة السر/);
  assert.equal(ctx.db.get('SELECT COUNT(*) AS n FROM merchants').n, 0);
});

test('signup creates a merchant with a trial, logs in, and blocks duplicates', async () => {
  const { client, res, form, merchant } = await signup(ctx, { phone: '+20 100 000 1111', slug: 'Trial-Shop' });
  assert.equal(res.status, 303);
  assert.equal(res.location, '/dashboard?msg=welcome');
  assert.ok(merchant, 'slug is lower-cased');
  assert.equal(merchant.phone, '01000001111');
  assert.equal(merchant.whatsapp, '01000001111', 'whatsapp defaults to phone');
  assert.equal(merchant.plan_expires_at, ctx.clock.t + ctx.config.trialDays * DAY);
  assert.notEqual(merchant.password_hash, form.password);

  const dash = await client.get('/dashboard');
  assert.equal(dash.status, 200);
  assert.match(dash.text, /الباقة الاحترافية/);

  const dupPhone = await signup(ctx, { phone: '01000001111' });
  assert.equal(dupPhone.res.status, 400);
  assert.match(dupPhone.res.text, /متسجل قبل كده/);
  const dupSlug = await signup(ctx, { slug: 'trial-shop' });
  assert.equal(dupSlug.res.status, 400);
  assert.match(dupSlug.res.text, /مستخدم/);
});

test('login, wrong password, logout', async () => {
  const { form } = await signup(ctx);
  const c = ctx.client();
  await c.get('/login');
  const bad = await c.post('/login', { phone: form.phone, password: 'nope-nope' });
  assert.equal(bad.status, 400);
  assert.match(bad.text, /غلط/);
  const good = await c.post('/login', { phone: form.phone, password: form.password });
  assert.equal(good.status, 303);
  assert.equal(good.location, '/dashboard');
  assert.equal((await c.get('/dashboard')).status, 200);
  const out = await c.post('/logout');
  assert.equal(out.status, 303);
  const after = await c.get('/dashboard');
  assert.equal(after.status, 303);
  assert.equal(after.location, '/login');
});

test('login is rate limited per account', async () => {
  const { form } = await signup(ctx);
  const c = ctx.client();
  await c.get('/login');
  let last;
  for (let i = 0; i < 11; i++) last = await c.post('/login', { phone: form.phone, password: 'wrong-pass' });
  assert.equal(last.status, 429);
  // Even the right password is refused while limited.
  const r = await c.post('/login', { phone: form.phone, password: form.password });
  assert.equal(r.status, 429);
});

test('dashboard requires login', async () => {
  const c = ctx.client();
  for (const p of ['/dashboard', '/dashboard/products', '/dashboard/orders', '/dashboard/settings', '/dashboard/billing']) {
    const r = await c.get(p);
    assert.equal(r.status, 303, p);
    assert.equal(r.location, '/login');
  }
});

test('POST without a valid CSRF token is rejected', async () => {
  const { client, merchant } = await signup(ctx);
  const r = await client.post('/dashboard/settings', { _csrf: 'wrong', store_name: 'Hacked', slug: merchant.slug, whatsapp: merchant.phone, accent: 'blue' });
  assert.equal(r.status, 403);
  assert.equal(ctx.db.get('SELECT store_name FROM merchants WHERE id = ?', merchant.id).store_name, merchant.store_name);

  // Multipart to a non-upload route must not bypass CSRF.
  const fd = new FormData();
  fd.set('x', '1');
  ctx.db.run('INSERT INTO products (merchant_id, name, price, created_at) VALUES (?, ?, ?, ?)', merchant.id, 'p', 100, ctx.clock.t);
  const pid = ctx.db.get('SELECT id FROM products WHERE merchant_id = ?', merchant.id).id;
  const mp = await client.request('POST', `/dashboard/products/${pid}/delete`, { body: fd });
  assert.equal(mp.status, 403);
  assert.ok(ctx.db.get('SELECT 1 FROM products WHERE id = ?', pid), 'product not deleted');

  // Upload route without a token.
  const up = await client.postMultipart('/dashboard/products/new', { name: 'x', price: '1' }, null, { csrf: false });
  assert.equal(up.status, 403);
});

test('products: create, validate, edit, toggle, delete; ownership enforced', async () => {
  const { client, merchant } = await signup(ctx);
  const bad = await addProduct(client, { name: '', price: 'abc' });
  assert.equal(bad.status, 400);
  assert.match(bad.text, /اسم المنتج/);
  assert.match(bad.text, /السعر/);

  const ok = await addProduct(client, { name: 'كنافة', price: '١٢٠٫٥', description: 'لذيذة' });
  assert.equal(ok.status, 303);
  const p = ctx.db.get('SELECT * FROM products WHERE merchant_id = ?', merchant.id);
  assert.equal(p.name, 'كنافة');
  assert.equal(p.price, 12050);

  const edit = await client.postMultipart(`/dashboard/products/${p.id}/edit`, { name: 'كنافة نوتيلا', price: '150' });
  assert.equal(edit.status, 303);
  assert.equal(ctx.db.get('SELECT price FROM products WHERE id = ?', p.id).price, 15000);

  await client.post(`/dashboard/products/${p.id}/toggle`);
  assert.equal(ctx.db.get('SELECT available FROM products WHERE id = ?', p.id).available, 0);

  // Another merchant cannot touch it.
  const other = await signup(ctx);
  assert.equal((await other.client.get(`/dashboard/products/${p.id}/edit`)).status, 404);
  assert.equal((await other.client.post(`/dashboard/products/${p.id}/delete`)).status, 404);
  assert.equal((await other.client.postMultipart(`/dashboard/products/${p.id}/edit`, { name: 'x', price: '1' })).status, 404);
  assert.ok(ctx.db.get('SELECT 1 FROM products WHERE id = ?', p.id));

  const del = await client.post(`/dashboard/products/${p.id}/delete`);
  assert.equal(del.status, 303);
  assert.equal(ctx.db.get('SELECT 1 FROM products WHERE id = ?', p.id), undefined);
});

test('image upload: real images stored, fake images rejected, replaced images removed', async () => {
  const { client, merchant } = await signup(ctx);
  const uploadDir = path.join(ctx.dataDir, 'uploads');

  const fake = await addProduct(client, { name: 'fake' }, { bytes: Buffer.from('<?php echo 1; ?>'), type: 'image/png', name: 'x.png' });
  assert.equal(fake.status, 400);
  assert.match(fake.text, /مش صورة سليمة/);
  const wrongType = await addProduct(client, { name: 'svg' }, { bytes: Buffer.from('<svg/>'), type: 'image/svg+xml', name: 'x.svg' });
  assert.equal(wrongType.status, 400);
  assert.equal(ctx.db.get('SELECT COUNT(*) AS n FROM products WHERE merchant_id = ?', merchant.id).n, 0);
  assert.equal(fs.readdirSync(uploadDir).length, 0, 'rejected files are deleted');

  const big = await addProduct(client, { name: 'big' }, { bytes: Buffer.concat([PNG_BYTES, Buffer.alloc(2 * 1024 * 1024)]), type: 'image/png', name: 'big.png' });
  assert.equal(big.status, 400);
  assert.match(big.text, /2 ميجا/);

  const good = await addProduct(client, { name: 'صورة' }, { bytes: PNG_BYTES, type: 'image/png', name: 'a.png' });
  assert.equal(good.status, 303);
  const p = ctx.db.get('SELECT * FROM products WHERE merchant_id = ?', merchant.id);
  assert.match(p.image, /^[A-Za-z0-9_-]+\.png$/);
  const img = await client.get(`/uploads/${p.image}`);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/png');

  await client.postMultipart(`/dashboard/products/${p.id}/edit`, { name: 'صورة', price: '10' }, { bytes: PNG_BYTES, type: 'image/png', name: 'b.png' });
  const updated = ctx.db.get('SELECT image FROM products WHERE id = ?', p.id).image;
  assert.notEqual(updated, p.image);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(fs.existsSync(path.join(uploadDir, p.image)), false, 'old image removed');
  assert.equal(fs.existsSync(path.join(uploadDir, updated)), true);

  await client.postMultipart(`/dashboard/products/${p.id}/edit`, { name: 'صورة', price: '10', remove_image: '1' });
  assert.equal(ctx.db.get('SELECT image FROM products WHERE id = ?', p.id).image, null);
});

test('free plan: product limit, hidden extras, and branding badge', async () => {
  const { client, merchant } = await signup(ctx);
  const limit = ctx.config.freeProductLimit;
  for (let i = 1; i <= limit + 2; i++) {
    const r = await addProduct(client, { name: `منتج ${i}`, price: String(i) });
    assert.equal(r.status, 303, `trial allows product ${i}`);
  }
  let store = await ctx.client().get(`/s/${merchant.slug}`);
  assert.equal((store.text.match(/class="product[ "]/g) || []).length, limit + 2);
  assert.doesNotMatch(store.text, /اعمل متجر زي ده/, 'no badge on Pro');

  // Trial ends.
  ctx.clock.t += (ctx.config.trialDays + 1) * DAY;
  try {
    store = await ctx.client().get(`/s/${merchant.slug}`);
    assert.equal((store.text.match(/class="product[ "]/g) || []).length, limit, 'only first N visible');
    assert.match(store.text, new RegExp(`منتج ${limit}<`));
    assert.doesNotMatch(store.text, new RegExp(`منتج ${limit + 1}<`));
    assert.match(store.text, /اعمل متجر زي ده/);
    assert.match(store.text, new RegExp(`href="/\\?ref=${merchant.slug}"`));

    const blocked = await addProduct(client, { name: 'زيادة' });
    assert.equal(blocked.status, 400);
    assert.match(blocked.text, /وصلت لحد/);
    assert.equal((await client.get('/dashboard/products/new')).status, 403);
    const list = await client.get('/dashboard/products');
    assert.match(list.text, /مش ظاهرين للزباين/);
  } finally {
    ctx.clock.t -= (ctx.config.trialDays + 1) * DAY;
  }
});

test('storefront escapes merchant content (XSS)', async () => {
  const { client, merchant } = await signup(ctx, { store_name: '<img src=x onerror=alert(1)>' });
  await addProduct(client, { name: '"><script>alert(1)</script>', description: '<b>bold</b>' });
  const r = await ctx.client().get(`/s/${merchant.slug}`);
  assert.equal(r.status, 200);
  assert.doesNotMatch(r.text, /<script>alert/);
  assert.doesNotMatch(r.text, /<img src=x/);
  assert.doesNotMatch(r.text, /<b>bold/);
  assert.match(r.text, /&lt;script&gt;/);
});

test('orders: server computes totals, validates input, records order, builds WhatsApp link', async () => {
  const { client, merchant } = await signup(ctx, { whatsapp: '01112223333' });
  await client.post('/dashboard/settings', {
    store_name: merchant.store_name, slug: merchant.slug, whatsapp: '01112223333', description: '', accent: 'blue', delivery_fee: '25',
  });
  await addProduct(client, { name: 'شاي', price: '10.50' });
  await addProduct(client, { name: 'قهوة', price: '30' });
  await addProduct(client, { name: 'خلصان', price: '5' });
  const [tea, coffee, gone] = ctx.db.all('SELECT * FROM products WHERE merchant_id = ? ORDER BY id', merchant.id);
  await client.post(`/dashboard/products/${gone.id}/toggle`);

  const customer = ctx.client();
  const url = `/s/${merchant.slug}/order`;
  const base = { name: 'أحمد', phone: '٠١٠٩٨٧٦٥٤٣٢', address: 'شارع التحرير، الدقي', notes: 'من غير سكر' };

  assert.equal((await customer.postJson(url, { ...base, items: [] })).status, 400);
  assert.equal((await customer.postJson(url, { ...base, phone: '123', items: [{ id: tea.id, qty: 1 }] })).status, 400);
  assert.equal((await customer.postJson(url, { ...base, address: '', items: [{ id: tea.id, qty: 1 }] })).status, 400);
  assert.equal((await customer.postJson(url, { ...base, items: [{ id: tea.id, qty: 0 }] })).status, 400);
  assert.equal((await customer.postJson(url, { ...base, items: [{ id: tea.id, qty: 1.5 }] })).status, 400);
  assert.equal((await customer.postJson(url, { ...base, items: [{ id: tea.id, qty: 100 }] })).status, 400);
  assert.equal((await customer.postJson(url, { ...base, items: [{ id: tea.id, qty: 60 }, { id: tea.id, qty: 60 }] })).status, 400);
  assert.equal((await customer.postJson(url, { ...base, items: [{ id: gone.id, qty: 1 }] })).status, 409);
  assert.equal((await customer.postJson(`/s/no-such-store/order`, { ...base, items: [{ id: tea.id, qty: 1 }] })).status, 404);

  // Product from another store is refused.
  const other = await signup(ctx);
  await addProduct(other.client, { name: 'غريب', price: '1' });
  const foreign = ctx.db.get('SELECT id FROM products WHERE merchant_id = ?', other.merchant.id);
  assert.equal((await customer.postJson(url, { ...base, items: [{ id: foreign.id, qty: 1 }] })).status, 409);

  // Malformed JSON and non-JSON bodies.
  const broken = await customer.request('POST', url, { body: '{oops', headers: { 'content-type': 'application/json' } });
  assert.equal(broken.status, 400);
  const form = await customer.request('POST', url, { body: 'a=1', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  assert.equal(form.status, 415);

  const ok = await customer.postJson(url, {
    ...base,
    items: [{ id: tea.id, qty: 2, price: 1 }, { id: coffee.id, qty: 1 }, { id: tea.id, qty: 1 }],
  });
  assert.equal(ok.status, 201);
  const body = JSON.parse(ok.text);
  // 3 × 10.50 + 30 + 25 delivery = 86.50 EGP, regardless of the "price: 1" the client sent.
  assert.equal(body.total, 8650);
  assert.ok(body.whatsappUrl.startsWith('https://wa.me/201112223333?text='));
  const message = decodeURIComponent(body.whatsappUrl.split('?text=')[1]);
  assert.match(message, /3 × شاي = 31.50 ج.م/);
  assert.match(message, /1 × قهوة = 30 ج.م/);
  assert.match(message, /التوصيل: 25 ج.م/);
  assert.match(message, /الإجمالي: 86.50 ج.م/);
  assert.match(message, /01098765432/);
  assert.match(message, /من غير سكر/);

  const order = ctx.db.get('SELECT * FROM orders WHERE id = ?', body.orderId);
  assert.equal(order.merchant_id, merchant.id);
  assert.equal(order.total, 8650);
  assert.equal(order.status, 'new');

  // Merchant sees and updates it; another merchant cannot.
  const list = await client.get('/dashboard/orders');
  assert.match(list.text, /أحمد/);
  assert.equal((await other.client.post(`/dashboard/orders/${order.id}/status`, { status: 'done' })).status, 404);
  assert.equal((await client.post(`/dashboard/orders/${order.id}/status`, { status: 'done' })).status, 303);
  assert.equal(ctx.db.get('SELECT status FROM orders WHERE id = ?', order.id).status, 'done');
  await client.post(`/dashboard/orders/${order.id}/status`, { status: 'hacked' });
  assert.equal(ctx.db.get('SELECT status FROM orders WHERE id = ?', order.id).status, 'done');

  // Pro stats on the dashboard (merchant is on trial).
  const dash = await client.get('/dashboard');
  assert.match(dash.text, /86.50 ج.م/);
});

test('settings: validation and slug uniqueness', async () => {
  const a = await signup(ctx);
  const b = await signup(ctx);
  const taken = await b.client.post('/dashboard/settings', {
    store_name: 'B', slug: a.merchant.slug, whatsapp: b.merchant.phone, accent: 'green', delivery_fee: '0',
  });
  assert.equal(taken.status, 400);
  const badFee = await b.client.post('/dashboard/settings', {
    store_name: 'Bee', slug: b.merchant.slug, whatsapp: b.merchant.phone, accent: 'green', delivery_fee: '5000',
  });
  assert.equal(badFee.status, 400);
  const ok = await b.client.post('/dashboard/settings', {
    store_name: 'محل بي', slug: 'new-b-slug', whatsapp: '01299998888', accent: 'not-a-color', delivery_fee: '15', description: 'أهلاً',
  });
  assert.equal(ok.status, 303);
  const m = ctx.db.get('SELECT * FROM merchants WHERE id = ?', b.merchant.id);
  assert.equal(m.slug, 'new-b-slug');
  assert.equal(m.accent, 'green');
  assert.equal(m.delivery_fee, 1500);
  assert.equal(m.whatsapp, '01299998888');
});

test('password change logs out other devices', async () => {
  const { client, form } = await signup(ctx);
  const second = ctx.client();
  await second.get('/login');
  await second.post('/login', { phone: form.phone, password: form.password });
  assert.equal((await second.get('/dashboard')).status, 200);

  const wrong = await client.post('/dashboard/password', { current: 'bad', password: 'newpassword1' });
  assert.equal(wrong.status, 400);
  const ok = await client.post('/dashboard/password', { current: form.password, password: 'newpassword1' });
  assert.equal(ok.status, 303);
  assert.equal((await client.get('/dashboard')).status, 200, 'current device stays logged in');
  assert.equal((await second.get('/dashboard')).status, 303, 'other device logged out');
});

test('billing → admin approval → plan extended, referral rewarded once', async () => {
  const referrer = await signup(ctx);
  const refExpiry = referrer.merchant.plan_expires_at;

  const landing = await ctx.client().get(`/?ref=${referrer.merchant.slug}`);
  assert.match(landing.text, new RegExp(`/signup\\?ref=${referrer.merchant.slug}`));
  const signupPage = await ctx.client().get(`/signup?ref=${referrer.merchant.slug}`);
  assert.match(signupPage.text, new RegExp(`name="ref" value="${referrer.merchant.slug}"`));

  const referred = await signup(ctx, { ref: referrer.merchant.slug });
  assert.equal(referred.merchant.referred_by, referrer.merchant.id);

  // Bad payment form.
  const bad = await referred.client.post('/dashboard/billing', { plan: 'lifetime', method: 'cash', sender: '', reference: '' });
  assert.equal(bad.status, 400);

  const pay = await referred.client.post('/dashboard/billing', { plan: 'yearly', method: 'vodafone_cash', sender: '01055554444', reference: 'TX123456' });
  assert.equal(pay.status, 303);
  const payment = ctx.db.get('SELECT * FROM payments WHERE merchant_id = ?', referred.merchant.id);
  assert.equal(payment.amount, ctx.config.priceYearly * 100, 'amount comes from server config');
  assert.equal(payment.status, 'pending');

  const dup = await referred.client.post('/dashboard/billing', { plan: 'monthly', method: 'instapay', sender: 'me@ip', reference: 'TX2' });
  assert.equal(dup.status, 400, 'only one pending payment');

  // Admin approves.
  const admin = ctx.client();
  await admin.get('/admin/login');
  assert.equal((await admin.post('/admin/login', { password: 'wrong' })).status, 400);
  assert.equal((await admin.post('/admin/login', { password: 'admin-pass-123' })).status, 303);
  const home = await admin.get('/admin');
  assert.equal(home.status, 200);
  assert.match(home.text, /TX123456/);

  const before = ctx.db.get('SELECT plan_expires_at FROM merchants WHERE id = ?', referred.merchant.id).plan_expires_at;
  assert.equal((await admin.post(`/admin/payments/${payment.id}/approve`)).status, 303);
  const after = ctx.db.get('SELECT plan_expires_at FROM merchants WHERE id = ?', referred.merchant.id).plan_expires_at;
  assert.equal(after, before + 365 * DAY, 'stacks on top of remaining trial');
  assert.equal(ctx.db.get('SELECT plan_expires_at FROM merchants WHERE id = ?', referrer.merchant.id).plan_expires_at, refExpiry + ctx.config.referralRewardDays * DAY);

  // Approving again does nothing (double click safe).
  await admin.post(`/admin/payments/${payment.id}/approve`);
  assert.equal(ctx.db.get('SELECT plan_expires_at FROM merchants WHERE id = ?', referred.merchant.id).plan_expires_at, after);

  // Second payment by the same referred merchant does not reward the referrer again.
  await referred.client.post('/dashboard/billing', { plan: 'monthly', method: 'instapay', sender: 'me@ip', reference: 'TX999' });
  const p2 = ctx.db.get("SELECT id FROM payments WHERE reference = 'TX999'");
  await admin.post(`/admin/payments/${p2.id}/approve`);
  assert.equal(ctx.db.get('SELECT plan_expires_at FROM merchants WHERE id = ?', referrer.merchant.id).plan_expires_at, refExpiry + ctx.config.referralRewardDays * DAY);
  assert.equal(ctx.db.get('SELECT COUNT(*) AS n FROM referral_rewards').n, 1);

  const billing = await referrer.client.get('/dashboard/billing');
  assert.match(billing.text, /اشتركوا وكسبت عليهم: 1/);

  // Reject flow.
  await referred.client.post('/dashboard/billing', { plan: 'monthly', method: 'instapay', sender: 'me@ip', reference: 'TXBAD' });
  const p3 = ctx.db.get("SELECT id FROM payments WHERE reference = 'TXBAD'");
  await admin.post(`/admin/payments/${p3.id}/reject`);
  assert.equal(ctx.db.get('SELECT status FROM payments WHERE id = ?', p3.id).status, 'rejected');
});

test('admin: protected, extend, reset password', async () => {
  const anon = ctx.client();
  const r = await anon.get('/admin');
  assert.equal(r.status, 303);
  assert.equal(r.location, '/admin/login');
  assert.equal((await anon.post('/admin/payments/1/approve')).status, 303);

  // A merchant session is not an admin session.
  const { client: merchantClient, merchant, form } = await signup(ctx);
  assert.equal((await merchantClient.get('/admin')).status, 303);

  const admin = ctx.client();
  await admin.get('/admin/login');
  await admin.post('/admin/login', { password: 'admin-pass-123' });
  const search = await admin.get(`/admin?q=${encodeURIComponent(merchant.slug)}`);
  assert.match(search.text, new RegExp(merchant.slug));

  const before = merchant.plan_expires_at;
  await admin.post(`/admin/merchants/${merchant.id}/extend`, { days: '30' });
  assert.equal(ctx.db.get('SELECT plan_expires_at FROM merchants WHERE id = ?', merchant.id).plan_expires_at, before + 30 * DAY);
  await admin.post(`/admin/merchants/${merchant.id}/extend`, { days: '-5' });
  assert.equal(ctx.db.get('SELECT plan_expires_at FROM merchants WHERE id = ?', merchant.id).plan_expires_at, before + 30 * DAY);

  const reset = await admin.post(`/admin/merchants/${merchant.id}/reset-password`);
  assert.equal(reset.status, 200);
  const temp = /<code dir="ltr">([a-z0-9]+)<\/code>/.exec(reset.text)[1];
  assert.equal((await merchantClient.get('/dashboard')).status, 303, 'old sessions revoked');
  const login = ctx.client();
  await login.get('/login');
  assert.equal((await login.post('/login', { phone: form.phone, password: form.password })).status, 400);
  assert.equal((await login.post('/login', { phone: form.phone, password: temp })).status, 303);

  await admin.post('/admin/logout');
  assert.equal((await admin.get('/admin')).status, 303);
});

test('admin panel is disabled without ADMIN_PASSWORD', async () => {
  const other = await startApp({ ADMIN_PASSWORD: '' });
  try {
    const c = other.client();
    assert.equal((await c.get('/admin')).status, 404);
    assert.equal((await c.get('/admin/login')).status, 404);
  } finally {
    await other.close();
  }
});

test('signup is rate limited per network', async () => {
  const other = await startApp({ SIGNUPS_PER_HOUR_PER_IP: '2' });
  try {
    assert.equal((await signup(other)).res.status, 303);
    assert.equal((await signup(other)).res.status, 303);
    const third = await signup(other);
    assert.equal(third.res.status, 429);
    assert.match(third.res.text, /محاولات كتير/);
    other.clock.t += 61 * 60 * 1000;
    assert.equal((await signup(other)).res.status, 303, 'allowed again after an hour');
  } finally {
    await other.close();
  }
});

test('sessions expire', async () => {
  const { client } = await signup(ctx);
  assert.equal((await client.get('/dashboard')).status, 200);
  ctx.clock.t += 31 * DAY;
  try {
    assert.equal((await client.get('/dashboard')).status, 303);
  } finally {
    ctx.clock.t -= 31 * DAY;
  }
});
