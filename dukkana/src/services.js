// Business logic that touches the database. Routes stay thin; rules live here.
import { DAY, isPro } from './util.js';
import { newToken, sha256 } from './security.js';

export const SESSION_TTL = 30 * DAY;
export const ADMIN_SESSION_TTL = 12 * 60 * 60 * 1000;

export function createServices({ db, config, now }) {
  const services = {
    createSession({ merchantId = null, isAdmin = false }) {
      const token = newToken();
      const ttl = isAdmin ? ADMIN_SESSION_TTL : SESSION_TTL;
      db.run(
        'INSERT INTO sessions (token_hash, merchant_id, is_admin, expires_at) VALUES (?, ?, ?, ?)',
        sha256(token), merchantId, isAdmin ? 1 : 0, now() + ttl,
      );
      return { token, ttl };
    },

    getSession(token, { admin = false } = {}) {
      if (!token) return null;
      return db.get(
        'SELECT * FROM sessions WHERE token_hash = ? AND is_admin = ? AND expires_at > ?',
        sha256(token), admin ? 1 : 0, now(),
      ) || null;
    },

    deleteSession(token) {
      if (token) db.run('DELETE FROM sessions WHERE token_hash = ?', sha256(token));
    },

    deleteMerchantSessions(merchantId) {
      db.run('DELETE FROM sessions WHERE merchant_id = ?', merchantId);
    },

    purgeExpiredSessions() {
      db.run('DELETE FROM sessions WHERE expires_at <= ?', now());
    },

    merchantById(id) {
      return db.get('SELECT * FROM merchants WHERE id = ?', id) || null;
    },

    merchantBySlug(slug) {
      return db.get('SELECT * FROM merchants WHERE slug = ?', slug) || null;
    },

    isPro(merchant) {
      return isPro(merchant, now());
    },

    /** All products (dashboard view), oldest first: the free limit keeps the oldest ones. */
    allProducts(merchantId) {
      return db.all('SELECT * FROM products WHERE merchant_id = ? ORDER BY id', merchantId);
    },

    productCount(merchantId) {
      return db.get('SELECT COUNT(*) AS n FROM products WHERE merchant_id = ?', merchantId).n;
    },

    /** Products customers can see: all on Pro, only the first N on Free. */
    visibleProducts(merchant) {
      const limit = services.isPro(merchant) ? -1 : config.freeProductLimit;
      return db.all('SELECT * FROM products WHERE merchant_id = ? ORDER BY id LIMIT ?', merchant.id, limit);
    },

    canAddProduct(merchant) {
      return services.isPro(merchant) || services.productCount(merchant.id) < config.freeProductLimit;
    },

    /** Extend a merchant's Pro plan by `days`, starting from today or the current end date. */
    extendPlan(merchantId, days) {
      const m = services.merchantById(merchantId);
      if (!m) throw new Error('merchant not found');
      const start = Math.max(now(), m.plan_expires_at || 0);
      const expires = start + days * DAY;
      db.run('UPDATE merchants SET plan_expires_at = ? WHERE id = ?', expires, merchantId);
      return expires;
    },

    planPrice(plan) {
      if (plan === 'yearly') return { amount: config.priceYearly * 100, days: 365 };
      if (plan === 'monthly') return { amount: config.priceMonthly * 100, days: 30 };
      return null;
    },

    /**
     * Approve a pending payment: extend the plan and, the first time a referred
     * merchant pays, reward the referrer. Runs atomically; returns false if the
     * payment was not pending (e.g. double click).
     */
    approvePayment(paymentId) {
      return db.tx(() => {
        const p = db.get('SELECT * FROM payments WHERE id = ?', paymentId);
        if (!p || p.status !== 'pending') return false;
        db.run("UPDATE payments SET status = 'approved', reviewed_at = ? WHERE id = ?", now(), p.id);
        const days = p.plan === 'yearly' ? 365 : 30;
        services.extendPlan(p.merchant_id, days);

        const m = services.merchantById(p.merchant_id);
        if (m.referred_by) {
          const already = db.get('SELECT 1 FROM referral_rewards WHERE referred_id = ?', m.id);
          const referrer = services.merchantById(m.referred_by);
          if (!already && referrer) {
            db.run(
              'INSERT INTO referral_rewards (referred_id, referrer_id, created_at) VALUES (?, ?, ?)',
              m.id, referrer.id, now(),
            );
            services.extendPlan(referrer.id, config.referralRewardDays);
          }
        }
        return true;
      });
    },

    rejectPayment(paymentId) {
      const r = db.run(
        "UPDATE payments SET status = 'rejected', reviewed_at = ? WHERE id = ? AND status = 'pending'",
        now(), paymentId,
      );
      return r.changes > 0;
    },

    merchantStats(merchant) {
      const since = now() - 30 * DAY;
      const orders = db.all(
        "SELECT items, total, status FROM orders WHERE merchant_id = ? AND created_at >= ?",
        merchant.id, since,
      );
      let revenue30 = 0;
      const counts = new Map();
      for (const o of orders) {
        if (o.status === 'cancelled') continue;
        revenue30 += o.total;
        for (const it of JSON.parse(o.items)) {
          counts.set(it.name, (counts.get(it.name) || 0) + it.qty);
        }
      }
      const topProducts = [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([name, qty]) => ({ name, qty }));
      const newOrders = db.get(
        "SELECT COUNT(*) AS n FROM orders WHERE merchant_id = ? AND status = 'new'", merchant.id,
      ).n;
      return { orders30: orders.length, revenue30, topProducts, newOrders };
    },

    adminStats() {
      const t = now();
      const one = (sql, ...p) => db.get(sql, ...p).n;
      return {
        merchants: one('SELECT COUNT(*) AS n FROM merchants'),
        signups7: one('SELECT COUNT(*) AS n FROM merchants WHERE created_at >= ?', t - 7 * DAY),
        paidActive: one(
          "SELECT COUNT(DISTINCT m.id) AS n FROM merchants m JOIN payments p ON p.merchant_id = m.id AND p.status = 'approved' WHERE m.plan_expires_at > ?",
          t,
        ),
        revenue30: one("SELECT COALESCE(SUM(amount), 0) AS n FROM payments WHERE status = 'approved' AND reviewed_at >= ?", t - 30 * DAY),
        revenueTotal: one("SELECT COALESCE(SUM(amount), 0) AS n FROM payments WHERE status = 'approved'"),
        orders30: one('SELECT COUNT(*) AS n FROM orders WHERE created_at >= ?', t - 30 * DAY),
      };
    },
  };
  return services;
}
