import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OrderError, couponDiscount, couponProblem, normalizeCouponCode, parseItems, priceOrder,
} from '../src/pricing.js';
import { endOfCairoDay, socialUrl, toCsv } from '../src/routes/dashboard.js';
import { startApp, signup, DAY } from './helpers.js';

// ---------------------------------------------------------------- unit tests

const shop = { min_order: 0, pickup_enabled: 0, delivery_fee: 2000 };
const catalog = [
  { id: 1, name: 'A', price: 1050, available: 1 },
  { id: 2, name: 'B', price: 3000, available: 1 },
  { id: 3, name: 'C', price: 500, available: 0 },
];
const throwsOrder = (fn, status, re) =>
  assert.throws(fn, (e) => e instanceof OrderError && e.status === status && re.test(e.message));

test('parseItems validates and merges', () => {
  assert.deepEqual([...parseItems([{ id: 1, qty: 2 }, { id: 1, qty: 3 }, { id: 2, qty: 1 }])], [[1, 5], [2, 1]]);
  throwsOrder(() => parseItems([]), 400, /فاضية/);
  throwsOrder(() => parseItems('x'), 400, /فاضية/);
  throwsOrder(() => parseItems([{ id: 1, qty: 0 }]), 400, /كمية/);
  throwsOrder(() => parseItems([{ id: -1, qty: 1 }]), 400, /كمية/);
  throwsOrder(() => parseItems([{ id: 1, qty: 50 }, { id: 1, qty: 50 }]), 400, /كمية/);
  throwsOrder(() => parseItems(Array.from({ length: 51 }, (_, i) => ({ id: i + 1, qty: 1 }))), 400, /كتير/);
});

test('coupon discount math and rules', () => {
  assert.equal(couponDiscount({ kind: 'percent', value: 10 }, 9950), 995);
  assert.equal(couponDiscount({ kind: 'percent', value: 15 }, 999), 149, 'rounds down');
  assert.equal(couponDiscount({ kind: 'fixed', value: 5000 }, 3000), 3000, 'never more than the subtotal');
  assert.equal(couponDiscount({ kind: 'fixed', value: 1000 }, 3000), 1000);
  const c = { active: 1, expires_at: null, max_uses: null, uses: 0, min_subtotal: 0 };
  assert.equal(couponProblem(c, 100, 0), null);
  assert.match(couponProblem(null, 100, 0), /مش موجود/);
  assert.match(couponProblem({ ...c, active: 0 }, 100, 0), /مش موجود/);
  assert.match(couponProblem({ ...c, expires_at: 50 }, 100, 50), /انتهى/);
  assert.equal(couponProblem({ ...c, expires_at: 51 }, 100, 50), null);
  assert.match(couponProblem({ ...c, max_uses: 2, uses: 2 }, 100, 0), /خلص/);
  assert.match(couponProblem({ ...c, min_subtotal: 10000 }, 9999, 0), /100 ج.م/);
  assert.equal(normalizeCouponCode(' eid٢٠ '), 'EID20');
});

test('priceOrder: delivery, pickup, minimum order, coupon', () => {
  const items = [{ id: 1, qty: 2 }, { id: 2, qty: 1 }];
  const d = priceOrder({ merchant: shop, products: catalog, items, now: 0 });
  assert.deepEqual([d.subtotal, d.discount, d.deliveryFee, d.total, d.fulfillment], [5100, 0, 2000, 7100, 'delivery']);

  throwsOrder(() => priceOrder({ merchant: shop, products: catalog, items, fulfillment: 'pickup', now: 0 }), 400, /الاستلام/);
  const p = priceOrder({ merchant: { ...shop, pickup_enabled: 1 }, products: catalog, items, fulfillment: 'pickup', now: 0 });
  assert.deepEqual([p.deliveryFee, p.total], [0, 5100]);
  throwsOrder(() => priceOrder({ merchant: shop, products: catalog, items, fulfillment: 'drone', now: 0 }), 400, /توصيل أو استلام/);

  throwsOrder(() => priceOrder({ merchant: { ...shop, min_order: 6000 }, products: catalog, items, now: 0 }), 400, /أقل قيمة للطلب 60 ج.م/);
  assert.equal(priceOrder({ merchant: { ...shop, min_order: 5100 }, products: catalog, items, now: 0 }).subtotal, 5100);

  throwsOrder(() => priceOrder({ merchant: shop, products: catalog, items: [{ id: 3, qty: 1 }], now: 0 }), 409, /مش متاح/);
  throwsOrder(() => priceOrder({ merchant: shop, products: catalog, items: [{ id: 99, qty: 1 }], now: 0 }), 409, /مش متاح/);

  const coupon = { kind: 'percent', value: 20, active: 1, expires_at: null, max_uses: null, uses: 0, min_subtotal: 0 };
  const c = priceOrder({ merchant: shop, products: catalog, items, coupon, now: 0 });
  assert.deepEqual([c.subtotal, c.discount, c.deliveryFee, c.total], [5100, 1020, 2000, 6080], 'discount is on products only, not delivery');
});

test('socialUrl only accepts the right platform over http(s)', () => {
  assert.equal(socialUrl('https://www.facebook.com/myshop', 'facebook'), 'https://www.facebook.com/myshop');
  assert.equal(socialUrl('facebook.com/myshop', 'facebook'), 'https://facebook.com/myshop');
  assert.equal(socialUrl('http://instagram.com/x', 'instagram'), 'https://instagram.com/x');
  assert.equal(socialUrl('https://www.tiktok.com/@shop', 'tiktok'), 'https://www.tiktok.com/@shop');
  assert.equal(socialUrl('https://evil.com/facebook.com', 'facebook'), null);
  assert.equal(socialUrl('https://facebook.com.evil.com/', 'facebook'), null);
  assert.equal(socialUrl('javascript:alert(1)', 'facebook'), null);
  assert.equal(socialUrl('https://instagram.com/x', 'facebook'), null);
  assert.equal(socialUrl('https://user:pw@facebook.com/x', 'facebook'), 'https://facebook.com/x');
});

test('endOfCairoDay handles winter/summer time and bad dates', () => {
  assert.equal(new Date(endOfCairoDay('2026-01-15')).toISOString(), '2026-01-15T22:00:00.000Z');
  assert.equal(new Date(endOfCairoDay('2026-07-15')).toISOString(), '2026-07-15T21:00:00.000Z');
  assert.equal(endOfCairoDay('2026-02-30'), null);
  assert.equal(endOfCairoDay('15/01/2026'), null);
  assert.equal(endOfCairoDay(''), null);
});

test('toCsv quotes cells and neutralizes formulas', () => {
  assert.equal(toCsv([['a', 'b"c'], [1, '-5']]), '"a","b""c"\r\n"1","-5"');
  assert.equal(toCsv([['=HYPERLINK("x")', '+1', '@SUM(A1)', '-cmd']]), `"'=HYPERLINK(""x"")","'+1","'@SUM(A1)","'-cmd"`);
});

// --------------------------------------------------------- integration tests

let ctx;
test.before(async () => {
  ctx = await startApp();
});
test.after(async () => {
  await ctx.close();
});

const addProduct = (client, fields) =>
  client.postMultipart('/dashboard/products/new', { name: 'منتج', price: '10', ...fields });
const settings = (client, merchant, extra) =>
  client.post('/dashboard/settings', {
    store_name: merchant.store_name, slug: merchant.slug, whatsapp: merchant.phone, accent: 'green', delivery_fee: '20', ...extra,
  });
const customer = { name: 'هبة', phone: '01055556666', address: 'الزمالك، شارع 26 يوليو' };

test('offer price: validated, shown crossed out with a percentage badge', async () => {
  const { client, merchant } = await signup(ctx);
  const bad = await addProduct(client, { name: 'عرض', price: '100', compare_price: '90' });
  assert.equal(bad.status, 400);
  assert.match(bad.text, /أكبر من السعر الحالي/);
  assert.equal((await addProduct(client, { name: 'عرض', price: '75', compare_price: '100' })).status, 303);
  const p = ctx.db.get('SELECT * FROM products WHERE merchant_id = ?', merchant.id);
  assert.equal(p.compare_price, 10000);
  const store = await ctx.client().get(`/s/${merchant.slug}`);
  assert.match(store.text, /<s class="old-price">100 ج.م<\/s>/);
  assert.match(store.text, /خصم 25%/);
  // Clearing it removes the offer.
  await client.postMultipart(`/dashboard/products/${p.id}/edit`, { name: 'عرض', price: '75', compare_price: '' });
  assert.equal(ctx.db.get('SELECT compare_price FROM products WHERE id = ?', p.id).compare_price, null);
});

test('settings: minimum order, pickup, social links', async () => {
  const { client, merchant } = await signup(ctx);
  const bad = await settings(client, merchant, { facebook: 'https://evil.com', min_order: 'abc' });
  assert.equal(bad.status, 400);
  assert.match(bad.text, /لينك فيسبوك/);
  assert.match(bad.text, /أقل قيمة للطلب/);
  const ok = await settings(client, merchant, {
    min_order: '50', pickup_enabled: '1', facebook: 'facebook.com/myshop', instagram: 'https://instagram.com/myshop', tiktok: '',
  });
  assert.equal(ok.status, 303);
  const m = ctx.db.get('SELECT * FROM merchants WHERE id = ?', merchant.id);
  assert.deepEqual([m.min_order, m.pickup_enabled, m.facebook, m.instagram, m.tiktok], [5000, 1, 'https://facebook.com/myshop', 'https://instagram.com/myshop', '']);
  const store = await ctx.client().get(`/s/${merchant.slug}`);
  assert.match(store.text, /أقل طلب: 50 ج.م/);
  assert.match(store.text, /استلام من المحل/);
  assert.match(store.text, /href="https:\/\/facebook.com\/myshop"/);
  assert.doesNotMatch(store.text, /تيك توك/);
  assert.match(store.text, /data-min-order="5000"/);
  // Unchecking pickup turns it off.
  await settings(client, merchant, { min_order: '0' });
  assert.equal(ctx.db.get('SELECT pickup_enabled FROM merchants WHERE id = ?', merchant.id).pickup_enabled, 0);
});

test('orders: pickup (no address, no fee) and minimum order enforced', async () => {
  const { client, merchant } = await signup(ctx);
  await settings(client, merchant, { min_order: '30', pickup_enabled: '1' });
  await addProduct(client, { name: 'فطيرة', price: '25' });
  const pid = ctx.db.get('SELECT id FROM products WHERE merchant_id = ?', merchant.id).id;
  const url = `/s/${merchant.slug}/order`;
  const c = ctx.client();

  const small = await c.postJson(url, { ...customer, items: [{ id: pid, qty: 1 }] });
  assert.equal(small.status, 400);
  assert.match(JSON.parse(small.text).error, /أقل قيمة للطلب 30/);

  const pickup = await c.postJson(url, { ...customer, address: '', fulfillment: 'pickup', items: [{ id: pid, qty: 2 }] });
  assert.equal(pickup.status, 201);
  const body = JSON.parse(pickup.text);
  assert.equal(body.total, 5000);
  const msg = decodeURIComponent(body.whatsappUrl.split('?text=')[1]);
  assert.match(msg, /استلام من المحل/);
  assert.doesNotMatch(msg, /التوصيل:/);
  assert.doesNotMatch(msg, /العنوان/);
  const order = ctx.db.get('SELECT * FROM orders WHERE id = ?', body.orderId);
  assert.deepEqual([order.fulfillment, order.delivery_fee, order.total], ['pickup', 0, 5000]);

  const delivery = await c.postJson(url, { ...customer, address: '', items: [{ id: pid, qty: 2 }] });
  assert.equal(delivery.status, 400, 'delivery still needs an address');
  const ok = await c.postJson(url, { ...customer, items: [{ id: pid, qty: 2 }] });
  assert.equal(JSON.parse(ok.text).total, 7000);
});

test('coupons: Pro only, validation, apply, usage limits, isolation', async () => {
  const { client, merchant } = await signup(ctx);
  await settings(client, merchant, {});
  await addProduct(client, { name: 'شنطة', price: '200' });
  const pid = ctx.db.get('SELECT id FROM products WHERE merchant_id = ?', merchant.id).id;
  const items = [{ id: pid, qty: 1 }];

  // No coupons yet: no coupon box on the store.
  assert.doesNotMatch((await ctx.client().get(`/s/${merchant.slug}`)).text, /id="coupon-input"/);

  const invalid = await client.post('/dashboard/coupons', { code: 'a b', kind: 'percent', value: '95' });
  assert.equal(invalid.status, 400);
  assert.match(invalid.text, /الكود لازم/);
  assert.match(invalid.text, /من 1 لـ 90/);
  const past = await client.post('/dashboard/coupons', { code: 'OLD', kind: 'percent', value: '10', expires: '2025-12-01' });
  assert.match(past.text, /تاريخ الانتهاء لازم/);

  assert.equal((await client.post('/dashboard/coupons', { code: 'eid20', kind: 'percent', value: '20', max_uses: '2' })).status, 303);
  assert.equal((await client.post('/dashboard/coupons', { code: 'FIFTY', kind: 'fixed', value: '50', min_subtotal: '300' })).status, 303);
  const dup = await client.post('/dashboard/coupons', { code: 'EID20', kind: 'percent', value: '5' });
  assert.match(dup.text, /موجود قبل كده/);
  assert.match((await ctx.client().get(`/s/${merchant.slug}`)).text, /id="coupon-input"/);

  const c = ctx.client();
  const quote = await c.postJson(`/s/${merchant.slug}/quote`, { items, coupon: 'Eid20' });
  assert.equal(quote.status, 200);
  assert.deepEqual(JSON.parse(quote.text), {
    subtotal: 20000, discount: 4000, deliveryFee: 2000, total: 18000, coupon: { code: 'EID20', label: 'خصم 20%' },
  });
  const minFail = await c.postJson(`/s/${merchant.slug}/quote`, { items, coupon: 'FIFTY' });
  assert.equal(minFail.status, 400);
  assert.match(JSON.parse(minFail.text).error, /300 ج.م/);
  assert.equal((await c.postJson(`/s/${merchant.slug}/quote`, { items, coupon: 'NOPE' })).status, 400);

  const o1 = await c.postJson(`/s/${merchant.slug}/order`, { ...customer, items, coupon: 'eid20' });
  assert.equal(o1.status, 201);
  const b1 = JSON.parse(o1.text);
  assert.equal(b1.total, 18000);
  assert.match(decodeURIComponent(b1.whatsappUrl), /الخصم \(كوبون EID20\): -40 ج.م/);
  const saved = ctx.db.get('SELECT * FROM orders WHERE id = ?', b1.orderId);
  assert.deepEqual([saved.discount, saved.coupon_code], [4000, 'EID20']);

  assert.equal((await c.postJson(`/s/${merchant.slug}/order`, { ...customer, items, coupon: 'EID20' })).status, 201);
  const exhausted = await c.postJson(`/s/${merchant.slug}/order`, { ...customer, items, coupon: 'EID20' });
  assert.equal(exhausted.status, 400);
  assert.match(JSON.parse(exhausted.text).error, /خلص/);
  assert.equal(ctx.db.get("SELECT uses FROM coupons WHERE code = 'EID20' AND merchant_id = ?", merchant.id).uses, 2);

  // A coupon from another store doesn't work here.
  const other = await signup(ctx);
  await other.client.post('/dashboard/coupons', { code: 'OTHER', kind: 'percent', value: '50' });
  assert.equal((await c.postJson(`/s/${merchant.slug}/order`, { ...customer, items, coupon: 'OTHER' })).status, 400);

  // Paused coupon stops working; another merchant can't pause it.
  const fifty = ctx.db.get("SELECT id FROM coupons WHERE code = 'FIFTY' AND merchant_id = ?", merchant.id).id;
  assert.equal((await other.client.post(`/dashboard/coupons/${fifty}/toggle`)).status, 404);
  assert.equal((await other.client.post(`/dashboard/coupons/${fifty}/delete`)).status, 404);
  await client.post(`/dashboard/coupons/${fifty}/toggle`);
  assert.equal(ctx.db.get('SELECT active FROM coupons WHERE id = ?', fifty).active, 0);
  await client.post(`/dashboard/coupons/${fifty}/delete`);
  assert.equal(ctx.db.get('SELECT 1 FROM coupons WHERE id = ?', fifty), undefined);

  // When Pro ends, coupons stop working and can't be created.
  ctx.clock.t += (ctx.config.trialDays + 1) * DAY;
  try {
    const free = await client.post('/dashboard/coupons', { code: 'NEW1', kind: 'percent', value: '10' });
    assert.equal(free.status, 400);
    assert.match(free.text, /الاحترافية بس/);
    await ctx.db.run("INSERT INTO coupons (merchant_id, code, kind, value, created_at) VALUES (?, 'LEFT', 'percent', 10, 0)", merchant.id);
    assert.equal((await c.postJson(`/s/${merchant.slug}/quote`, { items, coupon: 'LEFT' })).status, 400);
  } finally {
    ctx.clock.t -= (ctx.config.trialDays + 1) * DAY;
  }
});

test('coupon expiry is enforced at the end of the chosen day (Cairo time)', async () => {
  const { client, merchant } = await signup(ctx);
  await addProduct(client, { name: 'x', price: '100' });
  const pid = ctx.db.get('SELECT id FROM products WHERE merchant_id = ?', merchant.id).id;
  // Test clock: 2026-01-01 10:00 UTC (12:00 Cairo).
  await client.post('/dashboard/coupons', { code: 'TODAY', kind: 'fixed', value: '10', expires: '2026-01-01' });
  const c = ctx.client();
  const q = () => c.postJson(`/s/${merchant.slug}/quote`, { items: [{ id: pid, qty: 1 }], coupon: 'TODAY' });
  assert.equal((await q()).status, 200);
  ctx.clock.t += 11 * 60 * 60 * 1000 + 59 * 60 * 1000; // 23:59 Cairo
  try {
    assert.equal((await q()).status, 200);
    ctx.clock.t += 2 * 60 * 1000; // 00:01 Cairo next day
    assert.equal((await q()).status, 400);
  } finally {
    ctx.clock.t -= 11 * 60 * 60 * 1000 + 61 * 60 * 1000;
  }
});

test('orders Excel export: Pro only, all orders, Arabic-safe', async () => {
  const { client, merchant } = await signup(ctx);
  await addProduct(client, { name: '=كيك', price: '40' });
  const pid = ctx.db.get('SELECT id FROM products WHERE merchant_id = ?', merchant.id).id;
  await ctx.client().postJson(`/s/${merchant.slug}/order`, { ...customer, notes: 'بسرعة, لو سمحت', items: [{ id: pid, qty: 3 }] });

  const res = await fetch(`${ctx.url}/dashboard/orders.csv`, { headers: { cookie: client.cookieHeader('/') } });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/csv; charset=utf-8/);
  assert.match(res.headers.get('content-disposition'), /orders-2026-01-01\.csv/);
  const bytes = Buffer.from(await res.arrayBuffer());
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'BOM so Excel shows Arabic correctly');
  const lines = bytes.subarray(3).toString('utf8').split('\r\n');
  assert.equal(lines.length, 2);
  assert.match(lines[0], /"رقم الطلب","التاريخ","الاسم"/);
  assert.match(lines[1], /"2026-01-01 12:00","هبة","01055556666","توصيل"/);
  assert.match(lines[1], /"3 × =كيك"/);
  assert.match(lines[1], /"120.00","0.00","","0.00","120.00","جديد","بسرعة, لو سمحت"/);

  const orders = await client.get('/dashboard/orders');
  assert.match(orders.text, /href="\/dashboard\/orders.csv"/);

  ctx.clock.t += (ctx.config.trialDays + 1) * DAY;
  try {
    const free = await fetch(`${ctx.url}/dashboard/orders.csv`, { headers: { cookie: client.cookieHeader('/') }, redirect: 'manual' });
    assert.equal(free.status, 303);
    assert.equal(free.headers.get('location'), '/dashboard/billing');
  } finally {
    ctx.clock.t -= (ctx.config.trialDays + 1) * DAY;
  }
  // Not logged in.
  const anon = await fetch(`${ctx.url}/dashboard/orders.csv`, { redirect: 'manual' });
  assert.equal(anon.status, 303);
});
