import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import multer from 'multer';

import { createServices } from './services.js';
import { createRateLimiter, newToken, parseCookies, safeEqual } from './security.js';
import { simplePage } from './views/layout.js';
import { registerPublicRoutes } from './routes/public.js';
import { registerDashboardRoutes } from './routes/dashboard.js';
import { registerAdminRoutes } from './routes/admin.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(here, '..', 'public');

const IMAGE_TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

// Multipart (file upload) routes. Every other POST must be urlencoded/JSON so the
// global CSRF check can see the token. Multipart routes verify CSRF after parsing.
const MULTIPART_ROUTES = [
  /^\/dashboard\/products\/new$/,
  /^\/dashboard\/products\/\d+\/edit$/,
  /^\/dashboard\/settings\/logo$/,
];
const ORDER_ROUTE = /^\/s\/[^/]+\/(?:order|quote)$/;

/** Make sure the bytes really are the image type the browser claimed. */
function hasImageSignature(filePath, mimetype) {
  const buf = Buffer.alloc(12);
  const fd = fs.openSync(filePath, 'r');
  try {
    fs.readSync(fd, buf, 0, 12, 0);
  } finally {
    fs.closeSync(fd);
  }
  if (mimetype === 'image/png') return buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mimetype === 'image/jpeg') return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  if (mimetype === 'image/webp') return buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP';
  return false;
}

export function createApp({ config, db, now = Date.now }) {
  const app = express();
  const services = createServices({ db, config, now });
  const uploadDir = path.join(config.dataDir, 'uploads');
  fs.mkdirSync(uploadDir, { recursive: true });

  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);

  app.use((req, res, next) => {
    res.set({
      'Content-Security-Policy':
        "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    });
    if (config.secureCookies) res.set('Strict-Transport-Security', 'max-age=31536000');
    next();
  });

  app.get('/healthz', (req, res) => res.type('text').send('ok'));
  app.use(express.static(publicDir, { maxAge: '1d', index: false }));
  app.use('/uploads', express.static(uploadDir, { maxAge: '30d', immutable: true, index: false, dotfiles: 'deny' }));

  const cookieOpts = (maxAge, extra = {}) => ({
    httpOnly: true, sameSite: 'lax', secure: config.secureCookies, path: '/', maxAge, ...extra,
  });

  // Cookies, CSRF token (double-submit), and the logged-in merchant / admin.
  app.use((req, res, next) => {
    req.cookies = parseCookies(req.headers.cookie);
    let token = req.cookies.csrf;
    if (!token || !/^[A-Za-z0-9_-]{20,64}$/.test(token)) {
      token = newToken(24);
      res.cookie('csrf', token, cookieOpts(365 * 24 * 60 * 60 * 1000));
    }
    req.csrfToken = token;

    const session = services.getSession(req.cookies.sid);
    req.merchant = session ? services.merchantById(session.merchant_id) : null;
    req.isAdmin = Boolean(services.getSession(req.cookies.asid, { admin: true }));
    next();
  });

  app.use(express.urlencoded({ extended: false, limit: '64kb', parameterLimit: 50 }));
  app.use(express.json({ limit: '32kb' }));

  const csrfFailed = (res) =>
    res.status(403).send(simplePage({
      title: 'الصفحة قدمت',
      message: 'الصفحة دي اتفتحت من بدري أو الكوكيز مقفولة. ارجع للصفحة اللي قبلها، اعمل تحديث (Refresh)، وجرّب تاني.',
      status: '403',
    }));

  app.use((req, res, next) => {
    if (req.method !== 'POST') return next();
    if (ORDER_ROUTE.test(req.path)) {
      // Public JSON API: requiring JSON blocks cross-site HTML form posts.
      if (!req.is('application/json')) return res.status(415).json({ error: 'لازم الطلب يكون JSON.' });
      return next();
    }
    if (req.is('multipart/form-data')) {
      if (MULTIPART_ROUTES.some((re) => re.test(req.path))) return next();
      return csrfFailed(res);
    }
    if (!safeEqual(req.body?._csrf, req.csrfToken)) return csrfFailed(res);
    next();
  });

  const removeUpload = (filename) => {
    if (!filename) return;
    const safe = path.basename(filename);
    fs.rm(path.join(uploadDir, safe), { force: true }, () => {});
  };

  const upload = multer({
    storage: multer.diskStorage({
      destination: uploadDir,
      filename: (req, file, cb) => cb(null, newToken(16) + IMAGE_TYPES[file.mimetype]),
    }),
    limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 20, fieldSize: 16 * 1024 },
    fileFilter: (req, file, cb) => {
      if (IMAGE_TYPES[file.mimetype]) return cb(null, true);
      req.uploadError = 'نوع الصورة مش مدعوم. استخدم JPG أو PNG أو WEBP.';
      cb(null, false);
    },
  });

  /** Parse an optional single image, then verify CSRF. Sets req.uploadError on bad files. */
  const imageUpload = (req, res, next) => {
    upload.single('image')(req, res, (err) => {
      req.body = req.body || {};
      if (err) {
        req.uploadError = err.code === 'LIMIT_FILE_SIZE'
          ? 'الصورة أكبر من 2 ميجا. صغّرها أو ابعت صورة تانية.'
          : 'حصلت مشكلة في رفع الصورة، جرّب تاني.';
        if (req.file) removeUpload(req.file.filename);
        req.file = undefined;
      }
      if (!safeEqual(req.body._csrf, req.csrfToken)) {
        if (req.file) removeUpload(req.file.filename);
        return csrfFailed(res);
      }
      if (req.file) {
        let ok = false;
        try {
          ok = hasImageSignature(req.file.path, req.file.mimetype);
        } catch {
          ok = false;
        }
        if (!ok) {
          removeUpload(req.file.filename);
          req.file = undefined;
          req.uploadError = 'الملف ده مش صورة سليمة. جرّب صورة تانية.';
        }
      }
      next();
    });
  };

  const ctx = {
    db,
    config,
    now,
    services,
    imageUpload,
    removeUpload,
    cookieOpts,
    csrfFailed,
    ah: (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next),
    baseUrl: (req) => config.baseUrl || `${req.protocol}://${req.get('host')}`,
    limiters: {
      loginAccount: createRateLimiter({ windowMs: 15 * 60 * 1000, max: 10, now }),
      loginIp: createRateLimiter({ windowMs: 15 * 60 * 1000, max: 100, now }),
      signup: createRateLimiter({ windowMs: 60 * 60 * 1000, max: config.signupsPerHourPerIp, now }),
      order: createRateLimiter({ windowMs: 10 * 60 * 1000, max: 20, now }),
      quote: createRateLimiter({ windowMs: 10 * 60 * 1000, max: 60, now }),
      admin: createRateLimiter({ windowMs: 15 * 60 * 1000, max: 10, now }),
      payment: createRateLimiter({ windowMs: 60 * 60 * 1000, max: 5, now }),
    },
  };

  registerPublicRoutes(app, ctx);
  registerDashboardRoutes(app, ctx);
  registerAdminRoutes(app, ctx);

  app.use((req, res) => {
    res.status(404).send(simplePage({ title: 'الصفحة مش موجودة', message: 'اللينك ده غلط أو الصفحة اتشالت.', status: '404' }));
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const wantsJson = ORDER_ROUTE.test(req.path);
    if (err.type === 'entity.parse.failed' || err.type === 'entity.too.large' || err.status === 400 || err.status === 413) {
      const status = err.status === 413 || err.type === 'entity.too.large' ? 413 : 400;
      if (wantsJson) return res.status(status).json({ error: 'البيانات اللي اتبعتت مش سليمة.' });
      return res.status(status).send(simplePage({ title: 'حصلت مشكلة', message: 'البيانات اللي اتبعتت مش سليمة أو كبيرة زيادة.', status: String(status) }));
    }
    console.error(err);
    if (res.headersSent) return;
    if (wantsJson) return res.status(500).json({ error: 'حصلت مشكلة عندنا، جرّب تاني بعد شوية.' });
    res.status(500).send(simplePage({ title: 'حصلت مشكلة', message: 'حصلت مشكلة عندنا. جرّب تاني بعد شوية.', status: '500' }));
  });

  return app;
}
