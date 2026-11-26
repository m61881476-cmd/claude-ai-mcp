import { hashPassword, safeEqual, tempPassword } from '../security.js';
import fs from 'node:fs';
import path from 'node:path';
import { cleanText } from '../util.js';
import { snapshot } from '../backup.js';
import { newToken } from '../security.js';
import { adminHomePage, adminLoginPage } from '../views/admin.js';

const ADMIN_COOKIE_PATH = '/admin';

export function registerAdminRoutes(app, ctx) {
  const { db, config, now, services, ah, limiters, cookieOpts } = ctx;

  // Admin is disabled entirely (404) until ADMIN_PASSWORD is configured.
  app.use('/admin', (req, res, next) => {
    if (!config.adminPassword) return res.status(404).end();
    next();
  });

  app.get('/admin/login', (req, res) => {
    if (req.isAdmin) return res.redirect(303, '/admin');
    res.send(adminLoginPage({ csrf: req.csrfToken }));
  });

  app.post('/admin/login', (req, res) => {
    if (!limiters.admin.hit(req.ip)) {
      return res.status(429).send(adminLoginPage({ csrf: req.csrfToken, errors: ['محاولات كتير. استنى ربع ساعة.'] }));
    }
    if (!safeEqual(String(req.body.password ?? ''), config.adminPassword)) {
      return res.status(400).send(adminLoginPage({ csrf: req.csrfToken, errors: ['كلمة السر غلط.'] }));
    }
    const { token, ttl } = services.createSession({ isAdmin: true });
    res.cookie('asid', token, cookieOpts(ttl, { path: ADMIN_COOKIE_PATH }));
    res.redirect(303, '/admin');
  });

  app.use('/admin', (req, res, next) => {
    if (!req.isAdmin) return res.redirect(303, '/admin/login');
    next();
  });

  app.post('/admin/logout', (req, res) => {
    services.deleteSession(req.cookies.asid);
    res.clearCookie('asid', { path: ADMIN_COOKIE_PATH });
    res.redirect(303, '/admin/login');
  });

  const renderHome = (req, res, extra = {}) => {
    const q = cleanText(req.query.q, 60);
    const like = `%${q.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
    const merchants = db.all(
      `SELECT m.*, (SELECT COUNT(*) FROM products p WHERE p.merchant_id = m.id) AS products
       FROM merchants m
       WHERE ? = '' OR m.phone LIKE ? ESCAPE '\\' OR m.slug LIKE ? ESCAPE '\\' OR m.store_name LIKE ? ESCAPE '\\'
       ORDER BY m.id DESC LIMIT 100`,
      q, like, like, like,
    );
    const pending = db.all(
      `SELECT p.*, m.store_name, m.slug, m.phone FROM payments p JOIN merchants m ON m.id = p.merchant_id
       WHERE p.status = 'pending' ORDER BY p.id`,
    );
    res.send(adminHomePage({
      csrf: req.csrfToken,
      stats: services.adminStats(),
      pending,
      merchants,
      q,
      msg: typeof req.query.msg === 'string' ? req.query.msg : '',
      now: now(),
      ...extra,
    }));
  };

  app.get('/admin', (req, res) => renderHome(req, res));

  // One-click download of a full database backup.
  app.get('/admin/backup', (req, res, next) => {
    const tmp = path.join(config.dataDir, `backup-${newToken(8)}.db`);
    try {
      snapshot(db, tmp);
    } catch (err) {
      fs.rmSync(tmp, { force: true });
      return next(err);
    }
    const day = new Date(now()).toISOString().slice(0, 10);
    res.set('Cache-Control', 'no-store');
    res.download(tmp, `dukkana-backup-${day}.db`, () => fs.rmSync(tmp, { force: true }));
  });

  app.post('/admin/payments/:id(\\d+)/approve', (req, res) => {
    const ok = services.approvePayment(Number(req.params.id));
    res.redirect(303, ok ? '/admin?msg=approved' : '/admin');
  });

  app.post('/admin/payments/:id(\\d+)/reject', (req, res) => {
    const ok = services.rejectPayment(Number(req.params.id));
    res.redirect(303, ok ? '/admin?msg=rejected' : '/admin');
  });

  app.post('/admin/merchants/:id(\\d+)/extend', (req, res, next) => {
    const days = Number(req.body.days);
    if (!Number.isInteger(days) || days < 1 || days > 3650) return res.redirect(303, '/admin');
    const m = services.merchantById(Number(req.params.id));
    if (!m) return next();
    services.extendPlan(m.id, days);
    res.redirect(303, '/admin?msg=extended');
  });

  app.post('/admin/merchants/:id(\\d+)/reset-password', ah(async (req, res, next) => {
    const m = services.merchantById(Number(req.params.id));
    if (!m) return next();
    const password = tempPassword();
    db.run('UPDATE merchants SET password_hash = ? WHERE id = ?', await hashPassword(password), m.id);
    services.deleteMerchantSessions(m.id);
    res.set('Cache-Control', 'no-store');
    renderHome(req, res, { tempPassword: { store: m.store_name, password } });
  }));
}
