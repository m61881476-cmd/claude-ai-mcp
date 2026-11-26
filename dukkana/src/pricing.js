// Order pricing: the single source of truth for totals, discounts and fees.
// Everything is integer piasters. Pure functions, unit-tested.
import { formatMoney, normalizeDigits } from './util.js';

export const MAX_ORDER_LINES = 50;
export const MAX_QTY = 99;

export class OrderError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Validate and merge cart items into Map<productId, qty>. */
export function parseItems(items) {
  if (!Array.isArray(items) || items.length === 0) throw new OrderError(400, 'السلة فاضية.');
  if (items.length > MAX_ORDER_LINES) throw new OrderError(400, 'منتجات كتير زيادة في طلب واحد.');
  const wanted = new Map();
  for (const item of items) {
    const id = Number(item?.id);
    const qty = Number(item?.qty);
    if (!Number.isSafeInteger(id) || id <= 0 || !Number.isSafeInteger(qty) || qty < 1 || qty > MAX_QTY) {
      throw new OrderError(400, 'فيه منتج في السلة بكمية مش صحيحة.');
    }
    const total = (wanted.get(id) || 0) + qty;
    if (total > MAX_QTY) throw new OrderError(400, 'فيه منتج في السلة بكمية مش صحيحة.');
    wanted.set(id, total);
  }
  return wanted;
}

export const COUPON_RE = /^[\p{L}\p{N}_-]{2,20}$/u;

export function normalizeCouponCode(input) {
  return normalizeDigits(input).trim().toUpperCase();
}

export function couponDiscount(coupon, subtotal) {
  if (coupon.kind === 'percent') return Math.floor((subtotal * coupon.value) / 100);
  return Math.min(coupon.value, subtotal);
}

export function couponLabel(coupon) {
  return coupon.kind === 'percent' ? `خصم ${coupon.value}%` : `خصم ${formatMoney(coupon.value)}`;
}

/** Returns an Arabic error message if the coupon can't be used, else null. */
export function couponProblem(coupon, subtotal, now) {
  if (!coupon || !coupon.active) return 'الكوبون ده مش موجود.';
  if (coupon.expires_at != null && coupon.expires_at <= now) return 'الكوبون ده انتهى.';
  if (coupon.max_uses != null && coupon.uses >= coupon.max_uses) return 'الكوبون ده خلص.';
  if (subtotal < coupon.min_subtotal) {
    return `الكوبون ده بيشتغل على الطلبات من ${formatMoney(coupon.min_subtotal)} وأكتر.`;
  }
  return null;
}

/**
 * Price an order from the merchant's catalog (never from browser prices).
 * `products` = products the customer can currently see.
 */
export function priceOrder({ merchant, products, items, fulfillment = 'delivery', coupon = null, now }) {
  const wanted = parseItems(items);
  const catalog = new Map(products.filter((p) => p.available).map((p) => [p.id, p]));
  const lines = [];
  for (const [id, qty] of wanted) {
    const p = catalog.get(id);
    if (!p) throw new OrderError(409, 'فيه منتج في السلة بقى مش متاح. اعمل تحديث للصفحة وجرّب تاني.');
    lines.push({ id: p.id, name: p.name, price: p.price, qty });
  }
  const subtotal = lines.reduce((sum, l) => sum + l.price * l.qty, 0);
  if (subtotal < merchant.min_order) {
    throw new OrderError(400, `أقل قيمة للطلب ${formatMoney(merchant.min_order)}. ضيف منتجات كمان.`);
  }

  if (fulfillment !== 'delivery' && fulfillment !== 'pickup') throw new OrderError(400, 'اختار توصيل أو استلام.');
  if (fulfillment === 'pickup' && !merchant.pickup_enabled) throw new OrderError(400, 'المحل ده مش بيوفّر الاستلام من المحل.');
  const deliveryFee = fulfillment === 'delivery' ? merchant.delivery_fee : 0;

  let discount = 0;
  if (coupon) {
    const problem = couponProblem(coupon, subtotal, now);
    if (problem) throw new OrderError(400, problem);
    discount = couponDiscount(coupon, subtotal);
  }
  return { lines, subtotal, discount, deliveryFee, total: subtotal - discount + deliveryFee, fulfillment };
}
