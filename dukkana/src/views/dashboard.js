import { html } from '../html.js';
import { ACCENTS, formatDate, formatDateTime, formatMoney, priceInputValue } from '../util.js';
import { BRAND, page, csrfField, errorBox, notice } from './layout.js';

export const FLASH = {
  welcome: 'أهلاً بيك! متجرك جاهز. ضيف أول منتج وابعت اللينك لزباينك.',
  added: 'المنتج اتضاف.',
  updated: 'التعديلات اتحفظت.',
  deleted: 'المنتج اتمسح.',
  saved: 'الإعدادات اتحفظت.',
  payment: 'طلب الدفع وصلنا. هنراجعه ونفعّل الباقة في أقرب وقت (عادةً في نفس اليوم).',
  status: 'حالة الطلب اتغيرت.',
  opened: 'المتجر اتفتح، والزباين يقدروا يطلبوا دلوقتي.',
  coupon: 'الكوبون اتعمل. ابعت الكود لزباينك!',
  closed: 'المتجر اتقفل مؤقتاً. الزباين يقدروا يتفرجوا بس ومش هيقدروا يطلبوا.',
};

const ORDER_STATUS = { new: 'جديد', done: 'اتسلّم', cancelled: 'اتلغى' };

function dashHeader({ csrf, active }) {
  const links = [
    ['/dashboard', 'home', 'الرئيسية'],
    ['/dashboard/products', 'products', 'المنتجات'],
    ['/dashboard/orders', 'orders', 'الطلبات'],
    ['/dashboard/coupons', 'coupons', 'الكوبونات'],
    ['/dashboard/settings', 'settings', 'الإعدادات'],
    ['/dashboard/billing', 'billing', 'الاشتراك'],
  ];
  return html`<header class="topbar"><div class="wrap topbar-inner">
  <a class="logo" href="/dashboard">🛍️ ${BRAND}</a>
  <form method="post" action="/logout" class="inline">${csrfField(csrf)}<button class="link-btn" type="submit">خروج</button></form>
</div>
<nav class="dash-nav"><div class="wrap">${links.map(
    ([href, key, label]) => html`<a href="${href}" class="${key === active ? 'active' : ''}">${label}</a>`,
  )}</div></nav></header>`;
}

function dashPage({ title, csrf, active, body }) {
  return page({
    title: `${title} | ${BRAND}`,
    header: dashHeader({ csrf, active }),
    scripts: ['/dash.js?v=1'],
    body: html`<main class="wrap dash">${body}</main>`,
  });
}

function planBanner({ pro, daysLeft, productCount, config }) {
  if (pro) {
    return html`<div class="plan-banner pro">⭐ انت على الباقة الاحترافية، باقي <b>${daysLeft}</b> يوم.
    ${daysLeft <= 5 ? html`<a href="/dashboard/billing">جدّد دلوقتي</a>` : ''}</div>`;
  }
  return html`<div class="plan-banner">انت على الباقة المجانية (${productCount}/${config.freeProductLimit} منتج).
  <a href="/dashboard/billing">اشترك في الاحترافية بـ ${config.priceMonthly} ج.م بس</a></div>`;
}

export function homePage({ csrf, merchant, msg, storeUrl, pro, daysLeft, productCount, stats, recentOrders, config }) {
  const shareText = `اطلب من ${merchant.store_name} أونلاين: ${storeUrl}`;
  return dashPage({
    title: 'الرئيسية',
    csrf,
    active: 'home',
    body: html`
${notice(FLASH[msg])}
${planBanner({ pro, daysLeft, productCount, config })}
<section class="card store-toggle${merchant.is_open ? '' : ' is-closed'}">
  <div><b>${merchant.is_open ? '🟢 المتجر مفتوح وبياخد طلبات' : '🔴 المتجر مقفول ومش بياخد طلبات'}</b>
  <div class="muted small">${merchant.is_open ? 'لو أجازة أو خلصت الشغل النهارده، اقفله مؤقتاً.' : 'افتحه تاني لما تكون جاهز تستقبل طلبات.'}</div></div>
  <form method="post" action="/dashboard/store-status" class="inline">${csrfField(csrf)}
    <input type="hidden" name="open" value="${merchant.is_open ? '0' : '1'}">
    <button class="btn btn-small ${merchant.is_open ? 'btn-ghost' : ''}">${merchant.is_open ? 'اقفل المتجر مؤقتاً' : 'افتح المتجر'}</button>
  </form>
</section>
<section class="card">
  <h2>لينك متجرك</h2>
  <div class="copy-row"><input id="store-link" readonly value="${storeUrl}" dir="ltr"><button type="button" class="btn btn-small" data-copy="#store-link">انسخ</button></div>
  <div class="row-actions">
    <a class="btn btn-whatsapp btn-small" href="https://wa.me/?text=${encodeURIComponent(shareText)}" target="_blank" rel="noopener">شارك على واتساب</a>
    <a class="btn btn-ghost btn-small" href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(storeUrl)}" target="_blank" rel="noopener">شارك على فيسبوك</a>
    <a class="btn btn-ghost btn-small" href="${storeUrl}" target="_blank" rel="noopener">افتح المتجر</a>
  </div>
</section>
${productCount === 0
  ? html`<section class="card highlight"><h2>الخطوة الجاية: ضيف أول منتج</h2><p>المتجر من غير منتجات مش هيبيع. صوّر منتج من موبايلك وضيفه في أقل من دقيقة.</p><a class="btn" href="/dashboard/products/new">ضيف منتج</a></section>`
  : ''}
<section class="stats">
  <div class="stat"><b>${productCount}</b><span>منتج</span></div>
  <div class="stat"><b>${stats.orders30}</b><span>طلب آخر 30 يوم</span></div>
  <div class="stat"><b>${stats.newOrders}</b><span>طلب جديد</span></div>
  <div class="stat">${pro ? html`<b>${formatMoney(stats.revenue30)}</b>` : html`<b>🔒</b>`}<span>مبيعات آخر 30 يوم</span></div>
</section>
${pro && stats.topProducts.length
  ? html`<section class="card"><h2>أكتر المنتجات طلباً (30 يوم)</h2><ol>${stats.topProducts.map((t) => html`<li>${t.name}: ${t.qty} قطعة</li>`)}</ol></section>`
  : ''}
<section class="card">
  <h2>آخر الطلبات</h2>
  ${recentOrders.length ? orderTable(recentOrders, csrf) : html`<p class="muted">لسه مفيش طلبات. ابعت لينك المتجر في جروبات الواتساب وصفحتك على فيسبوك.</p>`}
  ${recentOrders.length ? html`<p><a href="/dashboard/orders">كل الطلبات ←</a></p>` : ''}
</section>`,
  });
}

function orderTable(orders, csrf) {
  return html`<div class="orders">${orders.map((o) => {
    const items = JSON.parse(o.items);
    return html`<article class="order order-${o.status}">
  <header><b>#${o.id}</b> · ${formatDateTime(o.created_at)} <span class="badge badge-${o.status}">${ORDER_STATUS[o.status] || o.status}</span></header>
  <p><b>${o.customer_name}</b> · <a href="tel:${o.customer_phone}" dir="ltr">${o.customer_phone}</a></p>
  <p class="muted small">${o.fulfillment === 'pickup' ? '🏪 استلام من المحل' : '🚚 توصيل'}${o.address ? html` · ${o.address}` : ''}</p>
  <ul class="small">${items.map((it) => html`<li>${it.qty} × ${it.name} (${formatMoney(it.price * it.qty)})</li>`)}</ul>
  ${o.notes ? html`<p class="small">📝 ${o.notes}</p>` : ''}
  ${o.discount ? html`<p class="small">🎟️ خصم ${formatMoney(o.discount)} (كوبون ${o.coupon_code})</p>` : ''}
  <p><b>الإجمالي: ${formatMoney(o.total)}</b>${o.delivery_fee ? html` <span class="muted small">(شامل توصيل ${formatMoney(o.delivery_fee)})</span>` : ''}</p>
  <form method="post" action="/dashboard/orders/${o.id}/status" class="row-actions">
    ${csrfField(csrf)}
    ${o.status !== 'done' ? html`<button class="btn btn-small" name="status" value="done">اتسلّم ✓</button>` : ''}
    ${o.status !== 'cancelled' ? html`<button class="btn btn-small btn-ghost" name="status" value="cancelled">اتلغى</button>` : ''}
    ${o.status !== 'new' ? html`<button class="btn btn-small btn-ghost" name="status" value="new">رجّعه جديد</button>` : ''}
  </form>
</article>`;
  })}</div>`;
}

export function ordersPage({ csrf, orders, msg, filter, pro = false }) {
  const tabs = [['all', 'الكل'], ['new', 'جديد'], ['done', 'اتسلّم'], ['cancelled', 'اتلغى']];
  return dashPage({
    title: 'الطلبات',
    csrf,
    active: 'orders',
    body: html`${notice(FLASH[msg])}
<div class="title-row"><h1>الطلبات</h1>
${pro
  ? html`<a class="btn btn-small btn-ghost" href="/dashboard/orders.csv">⬇️ نزّل الطلبات Excel</a>`
  : html`<a class="small" href="/dashboard/billing">🔒 تنزيل الطلبات Excel في الاحترافية</a>`}</div>
<nav class="tabs">${tabs.map(([k, label]) => html`<a href="/dashboard/orders?status=${k}" class="${filter === k ? 'active' : ''}">${label}</a>`)}</nav>
${orders.length ? orderTable(orders, csrf) : html`<p class="muted">مفيش طلبات هنا.</p>`}
${orders.length === 200 ? html`<p class="muted small">بيظهر آخر 200 طلب بس.</p>` : ''}`,
  });
}

export function productsPage({ csrf, products, msg, pro, config, errors = [] }) {
  const atLimit = !pro && products.length >= config.freeProductLimit;
  return dashPage({
    title: 'المنتجات',
    csrf,
    active: 'products',
    body: html`${notice(FLASH[msg])}${errorBox(errors)}
<div class="title-row"><h1>المنتجات</h1>
${atLimit ? '' : html`<a class="btn" href="/dashboard/products/new">+ ضيف منتج</a>`}</div>
${!pro
  ? html`<p class="plan-banner">${products.length}/${config.freeProductLimit} منتج في الباقة المجانية.
     ${atLimit ? html`<b>وصلت للحد الأقصى.</b>` : ''} <a href="/dashboard/billing">اشترك وضيف منتجات من غير حد</a></p>`
  : ''}
${!pro && products.length > config.freeProductLimit
  ? html`<p class="alert alert-error">فيه ${products.length - config.freeProductLimit} منتج مش ظاهرين للزباين لأن الباقة الاحترافية خلصت. جدّد عشان يظهروا تاني.</p>`
  : ''}
${products.length === 0
  ? html`<p class="muted">لسه مفيش منتجات.</p>`
  : html`<div class="plist">${products.map((p, i) => html`<div class="pitem${p.available ? '' : ' is-out'}${!pro && i >= config.freeProductLimit ? ' is-hidden' : ''}">
      ${p.image ? html`<img src="/uploads/${p.image}" alt="" loading="lazy">` : html`<div class="thumb-ph">${[...p.name][0] || '•'}</div>`}
      <div class="pitem-body"><b>${p.name}</b><span>${formatMoney(p.price)}${p.category ? ` · ${p.category}` : ''}${p.available ? '' : ' · مش متاح'}</span></div>
      <div class="pitem-actions">
        <a class="btn btn-small btn-ghost" href="/dashboard/products/${p.id}/edit">تعديل</a>
        <form method="post" action="/dashboard/products/${p.id}/toggle" class="inline">${csrfField(csrf)}<button class="btn btn-small btn-ghost">${p.available ? 'خلّيه مش متاح' : 'خلّيه متاح'}</button></form>
        <form method="post" action="/dashboard/products/${p.id}/delete" class="inline" data-confirm="متأكد إنك عايز تمسح المنتج ده؟">${csrfField(csrf)}<button class="btn btn-small btn-danger">امسح</button></form>
      </div>
    </div>`)}</div>`}`,
  });
}

export function productFormPage({ csrf, product = null, values = {}, errors = [], categories = [] }) {
  const editing = Boolean(product);
  const v = {
    name: values.name ?? product?.name ?? '',
    price: values.price ?? (product ? priceInputValue(product.price) : ''),
    description: values.description ?? product?.description ?? '',
    category: values.category ?? product?.category ?? '',
    compare_price: values.compare_price ?? (product?.compare_price ? priceInputValue(product.compare_price) : ''),
  };
  const action = editing ? `/dashboard/products/${product.id}/edit` : '/dashboard/products/new';
  return dashPage({
    title: editing ? 'تعديل منتج' : 'منتج جديد',
    csrf,
    active: 'products',
    body: html`<h1>${editing ? 'تعديل منتج' : 'منتج جديد'}</h1>
${errorBox(errors)}
<form method="post" action="${action}" enctype="multipart/form-data" class="card form">
  ${csrfField(csrf)}
  <label class="field"><span>اسم المنتج</span><input name="name" required maxlength="80" value="${v.name}"></label>
  <label class="field"><span>السعر (بالجنيه)</span><input name="price" required inputmode="decimal" value="${v.price}" placeholder="مثلاً 120" dir="ltr"></label>
  <label class="field"><span>السعر قبل الخصم (اختياري)</span><input name="compare_price" inputmode="decimal" value="${v.compare_price}" placeholder="لو عامل عرض، اكتب السعر القديم" dir="ltr">
    <small class="muted">هيظهر مشطوب جنب السعر الجديد، ومعاه نسبة الخصم.</small></label>
  <label class="field"><span>القسم (اختياري)</span><input name="category" maxlength="40" value="${v.category}" list="category-list" placeholder="مثلاً: حلويات شرقي، مشروبات، عروض">
    <small class="muted">المنتجات اللي ليها نفس القسم بتظهر مع بعض في المتجر.</small></label>
  <datalist id="category-list">${categories.map((c) => html`<option value="${c}"></option>`)}</datalist>
  <label class="field"><span>وصف قصير (اختياري)</span><textarea name="description" maxlength="500" rows="3">${v.description}</textarea></label>
  ${editing && product.image ? html`<div class="field"><span>الصورة الحالية</span><img class="preview" src="/uploads/${product.image}" alt="">
    <label class="check"><input type="checkbox" name="remove_image" value="1"> امسح الصورة</label></div>` : ''}
  <label class="field"><span>${editing && product.image ? 'غيّر الصورة (اختياري)' : 'صورة المنتج (اختياري)'}</span>
    <input type="file" name="image" accept="image/jpeg,image/png,image/webp">
    <small class="muted">JPG أو PNG أو WEBP، أقصى حجم 2 ميجا.</small></label>
  <button class="btn btn-block" type="submit">${editing ? 'احفظ التعديلات' : 'ضيف المنتج'}</button>
</form>
<p><a href="/dashboard/products">← ارجع للمنتجات</a></p>`,
  });
}

export function settingsPage({ csrf, merchant, values = {}, errors = [], msg }) {
  const v = {
    store_name: values.store_name ?? merchant.store_name,
    slug: values.slug ?? merchant.slug,
    whatsapp: values.whatsapp ?? merchant.whatsapp,
    description: values.description ?? merchant.description,
    accent: values.accent ?? merchant.accent,
    delivery_fee: values.delivery_fee ?? priceInputValue(merchant.delivery_fee),
    min_order: values.min_order ?? priceInputValue(merchant.min_order),
    pickup_enabled: values.pickup_enabled ?? Boolean(merchant.pickup_enabled),
    facebook: values.facebook ?? merchant.facebook,
    instagram: values.instagram ?? merchant.instagram,
    tiktok: values.tiktok ?? merchant.tiktok,
  };
  return dashPage({
    title: 'الإعدادات',
    csrf,
    active: 'settings',
    body: html`${notice(FLASH[msg])}
<h1>إعدادات المتجر</h1>
${errorBox(errors)}
<form method="post" action="/dashboard/settings" class="card form">
  ${csrfField(csrf)}
  <label class="field"><span>اسم المحل</span><input name="store_name" required maxlength="60" value="${v.store_name}"></label>
  <label class="field"><span>رابط المتجر</span><input name="slug" required maxlength="30" value="${v.slug}" dir="ltr" autocapitalize="off">
    <small class="muted">لو غيّرته، اللينك القديم هيبطل يشتغل.</small></label>
  <label class="field"><span>رقم الواتساب اللي بتوصلك عليه الطلبات</span><input name="whatsapp" type="tel" required value="${v.whatsapp}" dir="ltr"></label>
  <label class="field"><span>وصف المتجر (اختياري)</span><textarea name="description" maxlength="300" rows="3" placeholder="مثلاً: أحلى حلويات بيتي في مدينة نصر، التوصيل لحد باب البيت">${v.description}</textarea></label>
  <label class="field"><span>مصاريف التوصيل (بالجنيه، 0 لو مفيش)</span><input name="delivery_fee" inputmode="decimal" value="${v.delivery_fee}" dir="ltr"></label>
  <label class="field"><span>أقل قيمة للطلب (بالجنيه، 0 لو مفيش)</span><input name="min_order" inputmode="decimal" value="${v.min_order}" dir="ltr"></label>
  <label class="check"><input type="checkbox" name="pickup_enabled" value="1" ${v.pickup_enabled ? html`checked` : ''}> الزبون يقدر يختار "استلام من المحل" (من غير مصاريف توصيل)</label>
  <fieldset class="field"><legend>صفحاتك على السوشيال ميديا (اختياري)</legend>
    <input name="facebook" value="${v.facebook}" placeholder="لينك صفحة فيسبوك" dir="ltr">
    <input name="instagram" value="${v.instagram}" placeholder="لينك إنستجرام" dir="ltr" class="mt">
    <input name="tiktok" value="${v.tiktok}" placeholder="لينك تيك توك" dir="ltr" class="mt">
  </fieldset>
  <fieldset class="field"><legend>لون المتجر</legend><div class="swatches">
    ${Object.entries(ACCENTS).map(([key, label]) => html`<label class="swatch accent-${key}"><input type="radio" name="accent" value="${key}" ${v.accent === key ? html`checked` : ''}><span>${label}</span></label>`)}
  </div></fieldset>
  <button class="btn btn-block" type="submit">احفظ</button>
</form>
<form method="post" action="/dashboard/settings/logo" enctype="multipart/form-data" class="card form">
  ${csrfField(csrf)}
  <h2>لوجو المحل</h2>
  ${merchant.logo
    ? html`<img class="logo-preview" src="/uploads/${merchant.logo}" alt="اللوجو الحالي">
      <label class="check"><input type="checkbox" name="remove_logo" value="1"> امسح اللوجو</label>`
    : html`<p class="muted small">من غير لوجو، المتجر بيعرض أول حرف من اسم المحل.</p>`}
  <label class="field"><span>${merchant.logo ? 'غيّر اللوجو' : 'ارفع لوجو'}</span><input type="file" name="image" accept="image/jpeg,image/png,image/webp">
    <small class="muted">صورة مربعة أحسن. JPG أو PNG أو WEBP، أقصى حجم 2 ميجا.</small></label>
  <button class="btn btn-ghost" type="submit">احفظ اللوجو</button>
</form>
<form method="post" action="/dashboard/password" class="card form">
  ${csrfField(csrf)}
  <h2>تغيير كلمة السر</h2>
  <label class="field"><span>كلمة السر الحالية</span><input type="password" name="current" required autocomplete="current-password"></label>
  <label class="field"><span>كلمة السر الجديدة</span><input type="password" name="password" required minlength="8" autocomplete="new-password"></label>
  <button class="btn btn-ghost" type="submit">غيّر كلمة السر</button>
</form>`,
  });
}

export function billingPage({ csrf, merchant, pro, daysLeft, config, payments, referralUrl, referralStats, errors = [], values = {}, msg }) {
  const methods = [];
  if (config.vodafoneCash) methods.push(['vodafone_cash', `فودافون كاش: ${config.vodafoneCash}`]);
  if (config.instapay) methods.push(['instapay', `إنستاباي: ${config.instapay}`]);
  const hasPending = payments.some((p) => p.status === 'pending');
  const PAY_STATUS = { pending: 'قيد المراجعة', approved: 'اتفعّل ✓', rejected: 'مرفوض' };
  return dashPage({
    title: 'الاشتراك',
    csrf,
    active: 'billing',
    body: html`${notice(FLASH[msg])}
<h1>الاشتراك</h1>
${pro
  ? html`<div class="plan-banner pro">⭐ الباقة الاحترافية شغالة لحد ${formatDate(merchant.plan_expires_at)} (باقي ${daysLeft} يوم). أي دفع جديد بيتضاف على المدة الباقية.</div>`
  : html`<div class="plan-banner">انت على الباقة المجانية.</div>`}

<div class="plans">
  <div class="plan"><h3>شهري</h3><p class="price">${config.priceMonthly} <small>ج.م</small></p><p class="muted small">30 يوم</p></div>
  <div class="plan plan-pro"><h3>سنوي</h3><p class="price">${config.priceYearly} <small>ج.م</small></p><p class="muted small">365 يوم · وفّر ${Math.max(0, config.priceMonthly * 12 - config.priceYearly)} ج.م</p></div>
</div>

<section class="card">
  <h2>إزاي تدفع؟</h2>
  ${methods.length === 0
    ? html`<p class="alert alert-error">طرق الدفع لسه مش متظبطة. ${config.supportWhatsapp ? html`<a href="https://wa.me/${config.supportWhatsapp}">كلّمنا على واتساب</a>.` : ''}</p>`
    : html`<ol>
    <li>حوّل قيمة الباقة على: ${methods.map(([, label]) => html`<b class="ltr-inline">${label}</b> `)}</li>
    <li>اكتب بيانات التحويل في الفورم اللي تحت.</li>
    <li>هنراجع التحويل ونفعّل الباقة، عادةً في نفس اليوم.</li>
  </ol>
  ${errorBox(errors)}
  ${hasPending
    ? html`<p class="alert alert-success">عندك طلب دفع قيد المراجعة. هنفعّله أول ما نتأكد من التحويل.</p>`
    : html`<form method="post" action="/dashboard/billing" class="form">
    ${csrfField(csrf)}
    <fieldset class="field"><legend>الباقة</legend>
      <label class="check"><input type="radio" name="plan" value="monthly" ${values.plan !== 'yearly' ? html`checked` : ''}> شهري (${config.priceMonthly} ج.م)</label>
      <label class="check"><input type="radio" name="plan" value="yearly" ${values.plan === 'yearly' ? html`checked` : ''}> سنوي (${config.priceYearly} ج.م)</label>
    </fieldset>
    <fieldset class="field"><legend>حوّلت بإيه؟</legend>
      ${methods.map(([key, label], i) => html`<label class="check"><input type="radio" name="method" value="${key}" ${(values.method ? values.method === key : i === 0) ? html`checked` : ''}> ${label}</label>`)}
    </fieldset>
    <label class="field"><span>الرقم أو حساب إنستاباي اللي حوّلت منه</span><input name="sender" required maxlength="60" value="${values.sender || ''}" dir="ltr"></label>
    <label class="field"><span>رقم العملية (من رسالة التأكيد)</span><input name="reference" required maxlength="60" value="${values.reference || ''}" dir="ltr"></label>
    <button class="btn btn-block" type="submit">بعت بيانات التحويل</button>
  </form>`}`}
</section>

<section class="card">
  <h2>🎁 اكسب شهور مجانية</h2>
  <p>ابعت اللينك ده لأي صاحب محل. لما يسجل منه ويشترك، بتاخد <b>${config.referralRewardDays} يوم مجاناً</b> على الباقة الاحترافية.</p>
  <div class="copy-row"><input id="ref-link" readonly value="${referralUrl}" dir="ltr"><button type="button" class="btn btn-small" data-copy="#ref-link">انسخ</button></div>
  <a class="btn btn-whatsapp btn-small" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(`عملت متجر أونلاين لمحلي ببلاش والطلبات بتوصلني على واتساب. اعمل واحد لمحلك من هنا: ${referralUrl}`)}">ابعته على واتساب</a>
  <p class="muted small">سجّلوا من اللينك بتاعك: ${referralStats.signups} · اشتركوا وكسبت عليهم: ${referralStats.rewards}</p>
</section>

${payments.length
  ? html`<section class="card"><h2>سجل المدفوعات</h2><table class="table"><thead><tr><th>التاريخ</th><th>الباقة</th><th>المبلغ</th><th>الحالة</th></tr></thead><tbody>
    ${payments.map((p) => html`<tr><td>${formatDate(p.created_at)}</td><td>${p.plan === 'yearly' ? 'سنوي' : 'شهري'}</td><td>${formatMoney(p.amount)}</td><td>${PAY_STATUS[p.status] || p.status}</td></tr>`)}
  </tbody></table></section>`
  : ''}`,
  });
}

export function couponsPage({ csrf, coupons, pro, now, msg, errors = [], values = {}, config }) {
  const status = (c) => {
    if (!c.active) return html`<span class="badge">موقوف</span>`;
    if (c.expires_at != null && c.expires_at <= now) return html`<span class="badge badge-cancelled">انتهى</span>`;
    if (c.max_uses != null && c.uses >= c.max_uses) return html`<span class="badge badge-cancelled">خلص</span>`;
    return html`<span class="badge badge-new">شغال</span>`;
  };
  return dashPage({
    title: 'الكوبونات',
    csrf,
    active: 'coupons',
    body: html`${notice(FLASH[msg])}
<h1>كوبونات الخصم</h1>
<p class="muted">اعمل كود خصم (مثلاً RAMADAN أو عيد20) وانشره على صفحتك. الزبون يكتبه وهو بيطلب، والخصم يتحسب لوحده.</p>
${!pro
  ? html`<div class="plan-banner">🔒 الكوبونات متاحة في الباقة الاحترافية بس (${config.priceMonthly} ج.م/شهر). <a href="/dashboard/billing">اشترك</a></div>`
  : html`${errorBox(errors)}
<form method="post" action="/dashboard/coupons" class="card form">
  ${csrfField(csrf)}
  <h2>كوبون جديد</h2>
  <label class="field"><span>الكود</span><input name="code" required maxlength="20" value="${values.code || ''}" placeholder="مثلاً EID20" dir="auto" autocapitalize="characters"></label>
  <fieldset class="field"><legend>نوع الخصم</legend>
    <label class="check"><input type="radio" name="kind" value="percent" ${values.kind !== 'fixed' ? html`checked` : ''}> نسبة مئوية (%)</label>
    <label class="check"><input type="radio" name="kind" value="fixed" ${values.kind === 'fixed' ? html`checked` : ''}> مبلغ ثابت (جنيه)</label>
  </fieldset>
  <label class="field"><span>قيمة الخصم</span><input name="value" required inputmode="decimal" value="${values.value || ''}" placeholder="مثلاً 10" dir="ltr"></label>
  <label class="field"><span>أقل قيمة طلب عشان الكوبون يشتغل (اختياري)</span><input name="min_subtotal" inputmode="decimal" value="${values.min_subtotal || ''}" dir="ltr"></label>
  <label class="field"><span>أقصى عدد مرات استخدام (اختياري)</span><input name="max_uses" inputmode="numeric" value="${values.max_uses || ''}" dir="ltr"></label>
  <label class="field"><span>آخر يوم للكوبون (اختياري)</span><input name="expires" type="date" value="${values.expires || ''}" dir="ltr"></label>
  <button class="btn btn-block" type="submit">اعمل الكوبون</button>
</form>`}
${coupons.length
  ? html`<section class="card"><h2>الكوبونات بتاعتك</h2><div class="plist">${coupons.map((c) => html`<div class="pitem">
    <div class="pitem-body"><b dir="auto">${c.code}</b>
      <span>${c.kind === 'percent' ? `خصم ${c.value}%` : `خصم ${formatMoney(c.value)}`}${c.min_subtotal ? ` · على طلبات من ${formatMoney(c.min_subtotal)}` : ''}</span>
      <span>اتستخدم ${c.uses}${c.max_uses != null ? ` من ${c.max_uses}` : ''} مرة${c.expires_at != null ? ` · لحد ${formatDate(c.expires_at - 1)}` : ''}</span>
    </div>
    ${status(c)}
    <div class="pitem-actions">
      <form method="post" action="/dashboard/coupons/${c.id}/toggle" class="inline">${csrfField(csrf)}<button class="btn btn-small btn-ghost">${c.active ? 'وقّفه' : 'شغّله'}</button></form>
      <form method="post" action="/dashboard/coupons/${c.id}/delete" class="inline" data-confirm="تمسح الكوبون ده؟">${csrfField(csrf)}<button class="btn btn-small btn-danger">امسح</button></form>
    </div></div>`)}</div></section>`
  : ''}`,
  });
}
