import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';

export const DAY = 24 * 60 * 60 * 1000;

/** Start a fresh app (own temp dir + in-file DB) with a controllable clock. */
export async function startApp(env = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dukkana-test-'));
  const config = loadConfig({
    DATA_DIR: dataDir,
    ADMIN_PASSWORD: 'admin-pass-123',
    VODAFONE_CASH_NUMBER: '01011112222',
    INSTAPAY_ADDRESS: 'shop@instapay',
    SIGNUPS_PER_HOUR_PER_IP: '1000',
    ...env,
  });
  const db = openDb(path.join(dataDir, 'test.db'));
  const clock = { t: Date.UTC(2026, 0, 1, 10, 0, 0) };
  const app = createApp({ config, db, now: () => clock.t });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  return {
    url,
    db,
    config,
    clock,
    dataDir,
    client: () => new Client(url),
    async close() {
      await new Promise((r) => server.close(r));
      db.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

/** Tiny browser-like HTTP client with a cookie jar and automatic CSRF tokens. */
export class Client {
  constructor(base) {
    this.base = base;
    this.jar = new Map();
  }

  cookieHeader(pathname) {
    const parts = [];
    for (const [name, c] of this.jar) {
      if (pathname.startsWith(c.path)) parts.push(`${name}=${c.value}`);
    }
    return parts.join('; ');
  }

  store(res) {
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(';').map((s) => s.trim());
      const i = pair.indexOf('=');
      const name = pair.slice(0, i);
      const value = pair.slice(i + 1);
      const pathAttr = attrs.find((a) => a.toLowerCase().startsWith('path='));
      const cpath = pathAttr ? pathAttr.slice(5) : '/';
      const expired = attrs.some((a) => /^expires=/i.test(a) && new Date(a.slice(8)) < new Date()) || value === '';
      if (expired) this.jar.delete(name);
      else this.jar.set(name, { value, path: cpath });
    }
  }

  get csrf() {
    return this.jar.get('csrf')?.value;
  }

  async request(method, pathname, { body, headers = {} } = {}) {
    const res = await fetch(this.base + pathname, {
      method,
      redirect: 'manual',
      headers: { cookie: this.cookieHeader(pathname), ...headers },
      body,
    });
    this.store(res);
    const text = await res.text();
    return { status: res.status, headers: res.headers, text, location: res.headers.get('location') };
  }

  get(pathname) {
    return this.request('GET', pathname);
  }

  /** POST an urlencoded form. Adds the CSRF token unless `_csrf` is given. */
  async post(pathname, form = {}) {
    if (!this.csrf) await this.get('/');
    const data = new URLSearchParams({ _csrf: this.csrf, ...form });
    return this.request('POST', pathname, {
      body: data.toString(),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
  }

  /** POST multipart form data (FormData). */
  async postMultipart(pathname, fields = {}, file = null, { csrf = true } = {}) {
    if (!this.csrf) await this.get('/');
    const fd = new FormData();
    if (csrf) fd.set('_csrf', this.csrf);
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    if (file) fd.set('image', new Blob([file.bytes], { type: file.type }), file.name);
    return this.request('POST', pathname, { body: fd });
  }

  postJson(pathname, data) {
    return this.request('POST', pathname, {
      body: JSON.stringify(data),
      headers: { 'content-type': 'application/json' },
    });
  }
}

let phoneCounter = 0;

/** Sign up a merchant and return a logged-in client plus its data. */
export async function signup(ctx, overrides = {}) {
  phoneCounter++;
  const client = ctx.client();
  await client.get('/signup');
  const form = {
    store_name: 'محل تجربة',
    slug: `shop-${phoneCounter}-${Math.random().toString(36).slice(2, 7)}`,
    phone: `010${String(10000000 + phoneCounter).slice(-8)}`,
    whatsapp: '',
    password: 'password123',
    ...overrides,
  };
  const res = await client.post('/signup', form);
  return { client, res, form, merchant: ctx.db.get('SELECT * FROM merchants WHERE slug = ?', form.slug.trim().toLowerCase()) };
}

export const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
