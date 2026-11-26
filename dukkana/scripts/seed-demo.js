// Creates (or refreshes) a demo store at /s/demo so visitors can try the
// storefront before signing up. Safe to run more than once.
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db.js';
import { hashPassword, tempPassword } from '../src/security.js';

const config = loadConfig();
fs.mkdirSync(config.dataDir, { recursive: true });
const db = openDb(path.join(config.dataDir, 'dukkana.db'));

const DEMO_PHONE = '01000000000';
const products = [
  ['كنافة بالمانجا', 14500, 'علبة نص كيلو، كنافة طازة بكريمة ومانجا.', 'حلويات شرقي'],
  ['بسبوسة بالقشطة', 9000, 'صينية صغيرة تكفي 4 أفراد.', 'حلويات شرقي'],
  ['بلح الشام', 6000, 'ربع كيلو.', 'حلويات شرقي'],
  ['أم علي', 4500, 'طبق فردي بالمكسرات.', 'حلويات شرقي'],
  ['جاتوه شوكولاتة', 32000, 'تورتة 20 سم، لازم تطلبها قبلها بيوم.', 'تورت وكيك'],
  ['كيك فانيليا', 7500, '', 'تورت وكيك'],
  ['تشيز كيك فراولة', 12000, 'قطعة كبيرة.', 'تورت وكيك'],
  ['عصير مانجا فريش', 3500, 'كوباية كبيرة.', 'مشروبات'],
  ['سحلب بالمكسرات', 3000, '', 'مشروبات'],
];

const password = tempPassword(12);
const hash = await hashPassword(password);
const now = Date.now();

db.tx(() => {
  const existing = db.get("SELECT id FROM merchants WHERE slug = 'demo'");
  let id;
  if (existing) {
    id = existing.id;
    db.run('UPDATE merchants SET password_hash = ? WHERE id = ?', hash, id);
    db.run('DELETE FROM products WHERE merchant_id = ?', id);
  } else {
    id = Number(db.run(
      `INSERT INTO merchants (phone, password_hash, store_name, slug, whatsapp, description, accent, delivery_fee, plan_expires_at, created_at)
       VALUES (?, ?, ?, 'demo', ?, ?, 'pink', 2500, NULL, ?)`,
      DEMO_PHONE, hash, 'حلويات ست الكل (متجر تجريبي)', DEMO_PHONE,
      'ده متجر تجريبي عشان تشوف دكّانة شغالة إزاي. جرّب تضيف منتجات للسلة وتكمّل الطلب.', now,
    ).lastInsertRowid);
  }
  for (const [name, price, description, category] of products) {
    db.run('INSERT INTO products (merchant_id, name, price, description, category, created_at) VALUES (?, ?, ?, ?, ?, ?)', id, name, price, description, category, now);
  }
});

console.log('Demo store ready at /s/demo');
console.log(`Demo login: ${DEMO_PHONE} / ${password}`);
db.close();
