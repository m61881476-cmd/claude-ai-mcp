import fs from 'node:fs';
import path from 'node:path';

const KEEP = 14;

/**
 * Write a consistent snapshot of the database to `file` (safe while the app is
 * running: SQLite's VACUUM INTO reads a single transaction snapshot).
 */
export function snapshot(db, file) {
  fs.rmSync(file, { force: true });
  db.raw.prepare('VACUUM INTO ?').run(file);
}

/** Daily backup into DATA_DIR/backups, keeping the newest KEEP files. */
export function dailyBackup(db, dataDir, now = Date.now()) {
  const dir = path.join(dataDir, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const day = new Date(now).toISOString().slice(0, 10);
  const file = path.join(dir, `dukkana-${day}.db`);
  if (!fs.existsSync(file)) snapshot(db, file);
  const old = fs.readdirSync(dir).filter((f) => /^dukkana-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort().reverse().slice(KEEP);
  for (const f of old) fs.rmSync(path.join(dir, f), { force: true });
  return file;
}
