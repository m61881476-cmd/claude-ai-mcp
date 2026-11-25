import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanText, formatMoney, normalizeDigits, normalizePhone, parsePrice, priceInputValue,
  validateSlug, whatsappNumber,
} from '../src/util.js';
import { esc, html, raw } from '../src/html.js';
import { hashPassword, safeEqual, verifyPassword, parseCookies } from '../src/security.js';

test('normalizeDigits converts Arabic-Indic and Persian digits', () => {
  assert.equal(normalizeDigits('٠١٢٣٤٥٦٧٨٩'), '0123456789');
  assert.equal(normalizeDigits('۰۱۲۳۴۵۶۷۸۹'), '0123456789');
  assert.equal(normalizeDigits(null), '');
});

test('normalizePhone accepts valid Egyptian mobiles in many shapes', () => {
  for (const input of ['01012345678', '+201012345678', '00201012345678', '201012345678', '010 1234 5678', '010-1234-5678', '٠١٠١٢٣٤٥٦٧٨']) {
    assert.equal(normalizePhone(input), '01012345678', input);
  }
  assert.equal(normalizePhone('01112345678'), '01112345678');
  assert.equal(normalizePhone('01212345678'), '01212345678');
  assert.equal(normalizePhone('01512345678'), '01512345678');
});

test('normalizePhone rejects invalid numbers', () => {
  for (const input of ['', '0101234567', '010123456789', '01312345678', '0221234567', 'abc', '+1 555 1234567', null, undefined]) {
    assert.equal(normalizePhone(input), null, String(input));
  }
});

test('whatsappNumber builds the international form', () => {
  assert.equal(whatsappNumber('01012345678'), '201012345678');
});

test('parsePrice handles integers, decimals and Arabic digits', () => {
  assert.equal(parsePrice('120'), 12000);
  assert.equal(parsePrice('99.5'), 9950);
  assert.equal(parsePrice('99.05'), 9905);
  assert.equal(parsePrice(' 0.01 '), 1);
  assert.equal(parsePrice('١٢٠٫٥٠'), 12050);
  assert.equal(parsePrice('0'), 0);
  assert.equal(parsePrice('9999999.99'), 999999999);
});

test('parsePrice rejects bad input', () => {
  for (const input of ['', 'abc', '-5', '1,000', '1.234', '1e3', '12345678', '.5', '5.', 'NaN', null]) {
    assert.equal(parsePrice(input), null, String(input));
  }
});

test('formatMoney and priceInputValue', () => {
  assert.equal(formatMoney(12000), '120 ج.م');
  assert.equal(formatMoney(9950), '99.50 ج.م');
  assert.equal(formatMoney(123456700), '1,234,567 ج.م');
  assert.equal(formatMoney(0), '0 ج.م');
  assert.equal(priceInputValue(12000), '120');
  assert.equal(priceInputValue(9905), '99.05');
});

test('validateSlug', () => {
  assert.equal(validateSlug('my-shop'), null);
  assert.equal(validateSlug('abc'), null);
  assert.equal(validateSlug('a1b2c3'), null);
  assert.ok(validateSlug('ab'));
  assert.ok(validateSlug('-shop'));
  assert.ok(validateSlug('shop-'));
  assert.ok(validateSlug('my--shop'));
  assert.ok(validateSlug('My-Shop'));
  assert.ok(validateSlug('محل'));
  assert.ok(validateSlug('admin'));
  assert.ok(validateSlug('a'.repeat(31)));
  assert.equal(validateSlug('a'.repeat(30)), null);
});

test('cleanText trims, strips control chars and caps length', () => {
  assert.equal(cleanText('  hi  ', 10), 'hi');
  assert.equal(cleanText('a\u0000b', 10), 'a b');
  assert.equal(cleanText('line1\r\nline2', 50, { multiline: true }), 'line1\nline2');
  assert.equal(cleanText('line1\nline2', 50), 'line1 line2');
  assert.equal(cleanText('abcdef', 3), 'abc');
  assert.equal(cleanText(undefined, 3), '');
});

test('html template escapes everything except nested html', () => {
  const evil = '<script>alert("x")</script>';
  assert.equal(String(html`<p>${evil}</p>`), '<p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;</p>');
  assert.equal(String(html`<a title="${"' onclick=x"}">`), '<a title="&#39; onclick=x">');
  assert.equal(String(html`<ul>${['<a>', html`<li>ok</li>`]}</ul>`), '<ul>&lt;a&gt;<li>ok</li></ul>');
  assert.equal(String(html`${null}${undefined}${false}${0}`), '0');
  assert.equal(String(raw('<b>')), '<b>');
  assert.equal(esc('&'), '&amp;');
});

test('password hashing round-trips and rejects wrong passwords', async () => {
  const h = await hashPassword('secret-pass');
  assert.match(h, /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
  assert.equal(await verifyPassword('secret-pass', h), true);
  assert.equal(await verifyPassword('wrong', h), false);
  assert.equal(await verifyPassword('x', 'garbage'), false);
  assert.notEqual(await hashPassword('secret-pass'), h, 'salted');
});

test('safeEqual and parseCookies', () => {
  assert.equal(safeEqual('abc', 'abc'), true);
  assert.equal(safeEqual('abc', 'abd'), false);
  assert.equal(safeEqual('abc', 'abcd'), false);
  assert.equal(safeEqual(undefined, 'a'), false);
  const c = parseCookies('a=1; b=hello%20world; bad; a=2');
  assert.equal(c.a, '1');
  assert.equal(c.b, 'hello world');
});
