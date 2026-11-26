import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDb } from '../src/db.js';
import { dailyBackup } from '../src/backup.js';
import { startApp, signup, DAY } from './helpers.js';

test('dailyBackup writes a readable snapshot once per day and keeps 14', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dukkana-bk-'));
  try {
    const db = openDb(path.join(dir, 'live.db'));
    db.run("INSERT INTO merchants (phone, password_hash, store_name, slug, whatsapp, created_at) VALUES ('01000000009', 'x', 'محل', 'bk-shop', '01000000009', 1)");
    const t0 = Date.UTC(2026, 5, 1, 12);
    const file = dailyBackup(db, dir, t0);
    assert.match(path.basename(file), /^dukkana-2026-06-01\.db$/);
    const copy = new DatabaseSync(file, { readOnly: true });
    assert.equal(copy.prepare('SELECT store_name FROM merchants').get().store_name, 'محل');
    copy.close();

    const mtime = fs.statSync(file).mtimeMs;
    dailyBackup(db, dir, t0 + 60 * 60 * 1000);
    assert.equal(fs.statSync(file).mtimeMs, mtime, 'same day is not rewritten');

    for (let i = 1; i <= 20; i++) dailyBackup(db, dir, t0 + i * DAY);
    const files = fs.readdirSync(path.join(dir, 'backups')).sort();
    assert.equal(files.length, 14);
    assert.equal(files.at(-1), 'dukkana-2026-06-21.db');
    db.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('admin can download a backup; others cannot', async () => {
  const ctx = await startApp();
  try {
    const { merchant } = await signup(ctx, { store_name: 'محل النسخة' });
    const anon = ctx.client();
    const denied = await anon.get('/admin/backup');
    assert.equal(denied.status, 303);

    const admin = ctx.client();
    await admin.get('/admin/login');
    await admin.post('/admin/login', { password: 'admin-pass-123' });
    const res = await fetch(`${ctx.url}/admin/backup`, { headers: { cookie: admin.cookieHeader('/admin/backup') } });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-disposition'), /attachment; filename="dukkana-backup-\d{4}-\d{2}-\d{2}\.db"/);
    const bytes = Buffer.from(await res.arrayBuffer());
    assert.equal(bytes.subarray(0, 15).toString(), 'SQLite format 3');
    const out = path.join(ctx.dataDir, 'downloaded.db');
    fs.writeFileSync(out, bytes);
    const copy = new DatabaseSync(out, { readOnly: true });
    assert.equal(copy.prepare('SELECT store_name FROM merchants WHERE id = ?').get(merchant.id).store_name, 'محل النسخة');
    copy.close();
    await new Promise((r) => setTimeout(r, 50));
    assert.deepEqual(fs.readdirSync(ctx.dataDir).filter((f) => f.startsWith('backup-')), [], 'temp file cleaned up');
  } finally {
    await ctx.close();
  }
});
