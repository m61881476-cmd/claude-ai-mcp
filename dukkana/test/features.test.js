import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDb } from '../src/db.js';
import { groupByCategory } from '../src/views/public.js';
import { startApp, signup, PNG_BYTES } from './helpers.js';

let ctx;
test.before(async () => {
  ctx = await startApp();
});
test.after(async () => {
  await ctx.close();
});

const addProduct = (client, fields, file) =>
  client.postMultipart('/dashboard/products/new', { name: 'منتج', price: '10', ...fields }, file);

const order = (slug, items) =>
  ctx.client().postJson(`/s/${slug}/order`, { name: 'سارة', phone: '01011112233', address: 'المعادي، شارع 9', items });

test('old databases are upgraded in place without losing data', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dukkana-mig-'));
  const file = path.join(dir, 'old.db');
  const old = new DatabaseSync(file);
  old.exec(`
    CREATE TABLE merchants (id INTEGER PRIMARY KEY, phone TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
      store_name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, whatsapp TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
      accent TEXT NOT NULL DEFAULT 'green', delivery_fee INTEGER NOT NULL DEFAULT 0, plan_expires_at INTEGER,
      referred_by INTEGER, created_at INTEGER NOT NULL);
    CREATE TABLE products (id INTEGER PRIMARY KEY, merchant_id INTEGER NOT NULL, name TEXT NOT NULL, price INTEGER NOT NULL,
      description TEXT NOT NULL DEFAULT '', image TEXT, available INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL);
    INSERT INTO merchants (phone, password_hash, store_name, slug, whatsapp, created_at) VALUES ('01000000001', 'x', 'قديم', 'old-shop', '01000000001', 1);
    INSERT INTO products (merchant_id, name, price, created_at) VALUES (1, 'منتج قديم', 500, 1);
  `);
  old.close();
  try {
    const db = openDb(file);
    const m = db.get('SELECT * FROM merchants WHERE slug = ?', 'old-shop');
    assert.equal(m.store_name, 'قديم');
    assert.equal(m.is_open, 1);
    assert.equal(m.logo, null);
    const p = db.get('SELECT * FROM products WHERE merchant_id = ?', m.id);
    assert.equal(p.name, 'منتج قديم');
    assert.equal(p.category, '');
    db.close();
    // Opening again must not fail (migration is idempotent).
    openDb(file).close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('groupByCategory keeps order and puts uncategorized last', () => {
  const p = (id, category) => ({ id, category });
  assert.deepEqual(groupByCategory([p(1, ''), p(2, '')]), [{ name: '', items: [p(1, ''), p(2, '')] }]);
  const g = groupByCategory([p(1, 'مشروبات'), p(2, ''), p(3, 'حلويات'), p(4, 'مشروبات')]);
  assert.deepEqual(g.map((x) => x.name), ['مشروبات', 'حلويات', 'منتجات تانية']);
  assert.deepEqual(g[0].items.map((x) => x.id), [1, 4]);
  assert.deepEqual(g[2].items.map((x) => x.id), [2]);
  assert.deepEqual(groupByCategory([]), [{ name: '', items: [] }]);
});

test('categories: saved, suggested, grouped on the store, and escaped', async () => {
  const { client, merchant } = await signup(ctx);
  await addProduct(client, { name: 'شاي', category: 'مشروبات' });
  await addProduct(client, { name: 'بسبوسة', category: 'حلويات' });
  await addProduct(client, { name: 'قهوة', category: '  مشروبات  ' });
  await addProduct(client, { name: 'كيس', category: '' });
  await addProduct(client, { name: 'خطر', category: '<script>x</script>' });
  const rows = ctx.db.all('SELECT name, category FROM products WHERE merchant_id = ? ORDER BY id', merchant.id);
  assert.equal(rows[2].category, 'مشروبات', 'trimmed');

  const form = await client.get('/dashboard/products/new');
  assert.match(form.text, /<option value="مشروبات">/);
  assert.match(form.text, /<option value="حلويات">/);

  const p = rows.length && ctx.db.get("SELECT id FROM products WHERE name = 'شاي'");
  const edit = await client.get(`/dashboard/products/${p.id}/edit`);
  assert.match(edit.text, /name="category" maxlength="40" value="مشروبات"/);

  const store = await ctx.client().get(`/s/${merchant.slug}`);
  assert.match(store.text, /class="cat-nav"/);
  const titles = [...store.text.matchAll(/<h2 class="cat-title">([^<]*)<\/h2>/g)].map((m) => m[1]);
  assert.deepEqual(titles, ['مشروبات', 'حلويات', '&lt;script&gt;x&lt;/script&gt;', 'منتجات تانية']);
  assert.doesNotMatch(store.text, /<script>x<\/script>/);
  // Both drinks are in the first section.
  const firstSection = store.text.split('id="cat-1"')[0];
  assert.match(firstSection, /data-name="شاي"/);
  assert.match(firstSection, /data-name="قهوة"/);
});

test('stores without categories render a plain grid', async () => {
  const { client, merchant } = await signup(ctx);
  await addProduct(client, { name: 'واحد' });
  const store = await ctx.client().get(`/s/${merchant.slug}`);
  assert.doesNotMatch(store.text, /class="cat-nav"/);
  assert.doesNotMatch(store.text, /cat-title/);
  assert.match(store.text, /data-name="واحد"/);
});

test('search box appears only for stores with 8+ products', async () => {
  const { client, merchant } = await signup(ctx);
  for (let i = 1; i <= 7; i++) await addProduct(client, { name: `منتج ${i}` });
  assert.doesNotMatch((await ctx.client().get(`/s/${merchant.slug}`)).text, /id="product-search"/);
  await addProduct(client, { name: 'منتج 8' });
  assert.match((await ctx.client().get(`/s/${merchant.slug}`)).text, /id="product-search"/);
});

test('closing the store blocks orders; reopening allows them', async () => {
  const { client, merchant } = await signup(ctx);
  await addProduct(client, { name: 'فول', price: '15' });
  const pid = ctx.db.get('SELECT id FROM products WHERE merchant_id = ?', merchant.id).id;

  const dash = await client.get('/dashboard');
  assert.match(dash.text, /المتجر مفتوح/);

  const close = await client.post('/dashboard/store-status', { open: '0' });
  assert.equal(close.status, 303);
  assert.equal(close.location, '/dashboard?msg=closed');
  assert.equal(ctx.db.get('SELECT is_open FROM merchants WHERE id = ?', merchant.id).is_open, 0);
  assert.match((await client.get('/dashboard')).text, /المتجر مقفول/);

  const store = await ctx.client().get(`/s/${merchant.slug}`);
  assert.match(store.text, /class="closed-banner"/);
  assert.doesNotMatch(store.text, /data-qty-for/, 'no add-to-cart buttons while closed');
  assert.match(store.text, /data-name="فول"/, 'products still visible');

  const blocked = await order(merchant.slug, [{ id: pid, qty: 1 }]);
  assert.equal(blocked.status, 409);
  assert.match(JSON.parse(blocked.text).error, /مقفول/);
  assert.equal(ctx.db.get('SELECT COUNT(*) AS n FROM orders WHERE merchant_id = ?', merchant.id).n, 0);

  await client.post('/dashboard/store-status', { open: '1' });
  const reopened = await ctx.client().get(`/s/${merchant.slug}`);
  assert.doesNotMatch(reopened.text, /class="closed-banner"/);
  assert.match(reopened.text, /data-qty-for/);
  assert.equal((await order(merchant.slug, [{ id: pid, qty: 2 }])).status, 201);

  // CSRF protected.
  const bad = await client.post('/dashboard/store-status', { _csrf: 'nope', open: '0' });
  assert.equal(bad.status, 403);
  assert.equal(ctx.db.get('SELECT is_open FROM merchants WHERE id = ?', merchant.id).is_open, 1);
});

test('logo: upload, show on store, replace, remove; fake files and missing CSRF rejected', async () => {
  const { client, merchant } = await signup(ctx);
  const uploadDir = path.join(ctx.dataDir, 'uploads');
  const png = { bytes: PNG_BYTES, type: 'image/png', name: 'logo.png' };

  const noCsrf = await client.postMultipart('/dashboard/settings/logo', {}, png, { csrf: false });
  assert.equal(noCsrf.status, 403);
  assert.equal(ctx.db.get('SELECT logo FROM merchants WHERE id = ?', merchant.id).logo, null);

  const fake = await client.postMultipart('/dashboard/settings/logo', {}, { bytes: Buffer.from('not an image'), type: 'image/jpeg', name: 'x.jpg' });
  assert.equal(fake.status, 400);
  assert.match(fake.text, /مش صورة سليمة/);

  const ok = await client.postMultipart('/dashboard/settings/logo', {}, png);
  assert.equal(ok.status, 303);
  const logo1 = ctx.db.get('SELECT logo FROM merchants WHERE id = ?', merchant.id).logo;
  assert.match(logo1, /\.png$/);
  const store = await ctx.client().get(`/s/${merchant.slug}`);
  assert.match(store.text, new RegExp(`class="avatar avatar-img" src="/uploads/${logo1}"`));
  assert.match(store.text, new RegExp(`og:image" content="[^"]*/uploads/${logo1}"`));

  await client.postMultipart('/dashboard/settings/logo', {}, png);
  const logo2 = ctx.db.get('SELECT logo FROM merchants WHERE id = ?', merchant.id).logo;
  assert.notEqual(logo2, logo1);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(fs.existsSync(path.join(uploadDir, logo1)), false, 'old logo deleted');

  // Submitting without a file and without "remove" keeps the logo.
  await client.postMultipart('/dashboard/settings/logo', {});
  assert.equal(ctx.db.get('SELECT logo FROM merchants WHERE id = ?', merchant.id).logo, logo2);

  await client.postMultipart('/dashboard/settings/logo', { remove_logo: '1' });
  assert.equal(ctx.db.get('SELECT logo FROM merchants WHERE id = ?', merchant.id).logo, null);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(fs.existsSync(path.join(uploadDir, logo2)), false);
  assert.match((await ctx.client().get(`/s/${merchant.slug}`)).text, /<div class="avatar" aria-hidden="true">/);
});
