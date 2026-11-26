import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from './src/config.js';
import { openDb } from './src/db.js';
import { createApp } from './src/app.js';
import { createServices } from './src/services.js';
import { dailyBackup } from './src/backup.js';

const config = loadConfig();
fs.mkdirSync(config.dataDir, { recursive: true });
const db = openDb(path.join(config.dataDir, 'dukkana.db'));
const app = createApp({ config, db });

// Housekeeping: drop expired sessions on start and every hour.
const services = createServices({ db, config, now: Date.now });
services.purgeExpiredSessions();
setInterval(() => services.purgeExpiredSessions(), 60 * 60 * 1000).unref();

// Automatic daily database backup (DATA_DIR/backups, last 14 days kept).
const runBackup = () => {
  try {
    dailyBackup(db, config.dataDir);
  } catch (err) {
    console.error('Backup failed:', err);
  }
};
runBackup();
setInterval(runBackup, 60 * 60 * 1000).unref();

if (!config.adminPassword) console.warn('⚠️  ADMIN_PASSWORD is not set: the /admin panel is disabled.');
if (!config.vodafoneCash && !config.instapay) console.warn('⚠️  No payment method set (VODAFONE_CASH_NUMBER / INSTAPAY_ADDRESS).');
if (!config.baseUrl) console.warn('⚠️  BASE_URL is not set: store links will use the request Host header.');

const server = app.listen(config.port, () => {
  console.log(`Dukkana is running on http://localhost:${config.port}`);
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
