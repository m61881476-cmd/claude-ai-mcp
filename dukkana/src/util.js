// Small, pure helpers shared across the app. Everything here is unit-tested.

export const DAY = 24 * 60 * 60 * 1000;

/** Convert Arabic-Indic (٠-٩) and Persian (۰-۹) digits to ASCII digits. */
export function normalizeDigits(input) {
  return String(input ?? '')
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

/**
 * Normalize an Egyptian mobile number to the local 11-digit form (01xxxxxxxxx).
 * Accepts +20 / 0020 / 20 prefixes, spaces, dashes and Arabic digits.
 * Returns null when the number is not a valid Egyptian mobile.
 */
export function normalizePhone(input) {
  let s = normalizeDigits(input).replace(/[\s\-().]/g, '');
  if (s.startsWith('+20')) s = '0' + s.slice(3);
  else if (s.startsWith('0020')) s = '0' + s.slice(4);
  else if (s.startsWith('20') && s.length === 12) s = '0' + s.slice(2);
  return /^01[0125]\d{8}$/.test(s) ? s : null;
}

/** International form used by wa.me links (no plus sign). */
export function whatsappNumber(localPhone) {
  return '20' + localPhone.slice(1);
}

/**
 * Parse a price typed by a person ("120", "99.5", "١٢٠٫٥٠") into piasters (integer).
 * Money is always stored as integer piasters to avoid floating point errors.
 */
export function parsePrice(input) {
  const s = normalizeDigits(input).trim().replace(/٫/g, '.');
  const m = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] || '').padEnd(2, '0'));
}

const moneyWhole = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const moneyFrac = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function formatMoney(piasters) {
  const fmt = piasters % 100 === 0 ? moneyWhole : moneyFrac;
  return fmt.format(piasters / 100) + ' ج.م';
}

/** Value to pre-fill a price <input> with. */
export function priceInputValue(piasters) {
  return piasters % 100 === 0 ? String(piasters / 100) : (piasters / 100).toFixed(2);
}

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/;

export const RESERVED_SLUGS = new Set([
  'admin', 'api', 'app', 'dashboard', 'login', 'logout', 'signup', 'register', 'store', 'stores',
  'static', 'public', 'uploads', 'help', 'support', 'about', 'terms', 'privacy', 'pricing', 'billing',
  'dukkana', 'www', 'mail', 'root', 'settings', 'account', 'test', 'demo-admin',
]);

export function normalizeSlug(input) {
  return normalizeDigits(input).trim().toLowerCase();
}

export function validateSlug(slug) {
  if (!SLUG_RE.test(slug) || slug.includes('--')) {
    return 'رابط المتجر لازم يكون من 3 لـ 30 حرف إنجليزي صغير أو أرقام أو شَرطة (-)، ومايبدأش أو يخلص بشَرطة.';
  }
  if (RESERVED_SLUGS.has(slug)) return 'الرابط ده محجوز، اختار رابط تاني.';
  return null;
}

/**
 * Trim user text, drop control characters (keeping new lines when multiline),
 * and cap the length. Always returns a string.
 */
export function cleanText(input, max, { multiline = false } = {}) {
  let s = String(input ?? '');
  s = multiline
    ? s.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '')
    : s.replace(/[\u0000-\u001F\u007F]/g, ' ');
  s = s.trim();
  return s.length > max ? s.slice(0, max) : s;
}

const dateFmt = new Intl.DateTimeFormat('ar-EG', {
  timeZone: 'Africa/Cairo', year: 'numeric', month: 'long', day: 'numeric',
});
const dateTimeFmt = new Intl.DateTimeFormat('ar-EG', {
  timeZone: 'Africa/Cairo', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
});

export function formatDate(ms) {
  return dateFmt.format(new Date(ms));
}

export function formatDateTime(ms) {
  return dateTimeFmt.format(new Date(ms));
}

export const ACCENTS = {
  green: 'أخضر',
  blue: 'أزرق',
  purple: 'بنفسجي',
  orange: 'برتقالي',
  pink: 'وردي',
  teal: 'فيروزي',
  black: 'أسود',
};

export function isPro(merchant, now) {
  return merchant.plan_expires_at != null && merchant.plan_expires_at > now;
}

/** Days left (rounded up) until the plan ends, 0 if already ended. */
export function daysLeft(merchant, now) {
  if (!isPro(merchant, now)) return 0;
  return Math.ceil((merchant.plan_expires_at - now) / DAY);
}
