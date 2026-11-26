import { html } from '../html.js';
import { formatMoney } from '../util.js';
import { BRAND, page, publicHeader, csrfField, errorBox } from './layout.js';

export function landingPage({ config, refSlug, demoSlug }) {
  const signupHref = refSlug ? `/signup?ref=${encodeURIComponent(refSlug)}` : '/signup';
  return page({
    title: `${BRAND} | متجر أونلاين لمحلك في دقيقتين والطلبات على واتساب`,
    og: {
      title: `${BRAND}: اعمل متجر أونلاين لمحلك مجاناً`,
      description: 'من غير مبرمج ومن غير تكاليف: صوّر منتجاتك، ابعت اللينك لزباينك، والطلبات توصلك جاهزة على واتساب.',
    },
    header: publicHeader(),
    body: html`<main>
<section class="hero"><div class="wrap">
  <h1>محلك يبقى ليه متجر أونلاين <span class="hl">في دقيقتين</span></h1>
  <p class="lead">ضيف منتجاتك بأسعارها، وخد لينك واحد تبعته لزباينك على واتساب وفيسبوك.
  الزبون يختار ويطلب، والطلب يوصلك على واتساب مكتوب ومحسوب. من غير مكالمات ولا لخبطة في الحساب.</p>
  <div class="hero-cta">
    <a class="btn btn-big" href="${signupHref}">اعمل متجرك مجاناً</a>
    ${demoSlug ? html`<a class="btn btn-ghost btn-big" href="/s/${demoSlug}">شوف متجر تجريبي</a>` : ''}
  </div>
  <p class="muted small">مجاني للأبد لحد ${config.freeProductLimit} منتجات، و${config.trialDays} يوم من الباقة الاحترافية هدية. مش محتاج كارت بنك.</p>
</div></section>

<section class="wrap section">
  <h2 class="section-title">مين ينفعله ${BRAND}؟</h2>
  <div class="chips">
    <span>🍔 مطاعم وكافيهات</span><span>🧁 حلويات وأكل بيتي</span><span>👗 ملابس وإكسسوارات</span>
    <span>💊 صيدليات</span><span>🛒 سوبر ماركت وبقالة</span><span>📱 موبايلات وإكسسوارات</span>
    <span>🌸 ورد وهدايا</span><span>🧴 منتجات تجميل</span><span>📚 مكتبات</span>
  </div>
</section>

<section class="wrap section">
  <h2 class="section-title">إزاي بيشتغل؟</h2>
  <ol class="steps">
    <li><strong>سجّل في دقيقة</strong><span>اسم المحل ورقم الواتساب بس.</span></li>
    <li><strong>ضيف منتجاتك</strong><span>صورة من موبايلك واسم وسعر.</span></li>
    <li><strong>ابعت اللينك</strong><span>في الجروبات والستوري وصفحة الفيسبوك.</span></li>
    <li><strong>استقبل الطلبات</strong><span>الطلب يوصلك على واتساب فيه المنتجات والإجمالي والعنوان.</span></li>
  </ol>
</section>

<section class="wrap section">
  <h2 class="section-title">ليه أصحاب المحلات بيحبوه؟</h2>
  <div class="features">
    <div class="feature"><b>⚡ أسرع من أي حاجة</b><p>مش محتاج تتعلم برنامج ولا تدفع لمبرمج. لو بتعرف تبعت صورة على واتساب يبقى تعرف تستخدمه.</p></div>
    <div class="feature"><b>🧮 الحساب مظبوط</b><p>الإجمالي ومصاريف التوصيل بتتحسب أوتوماتيك، فمفيش خناقات على الحساب.</p></div>
    <div class="feature"><b>📋 كل طلباتك في مكان واحد</b><p>كل طلب بيتسجل عندك بالاسم والرقم والعنوان، حتى لو الرسالة ضاعت في الشات.</p></div>
    <div class="feature"><b>📈 بيع أكتر</b><p>الزبون بيشوف كل منتجاتك بالأسعار مرة واحدة بدل ما يسأل "بكام ده؟" ويمشي.</p></div>
  </div>
</section>

<section class="wrap section" id="pricing">
  <h2 class="section-title">الأسعار</h2>
  <div class="plans">
    <div class="plan">
      <h3>مجاني</h3>
      <p class="price">0 <small>ج.م</small></p>
      <ul>
        <li>لحد ${config.freeProductLimit} منتجات</li>
        <li>طلبات على واتساب من غير حد أقصى</li>
        <li>سجل الطلبات</li>
        <li>علامة "${BRAND}" في آخر المتجر</li>
      </ul>
      <a class="btn btn-ghost" href="${signupHref}">ابدأ مجاناً</a>
    </div>
    <div class="plan plan-pro">
      <h3>الاحترافية</h3>
      <p class="price">${config.priceMonthly} <small>ج.م / شهر</small></p>
      <p class="muted small">أو ${config.priceYearly} ج.م في السنة (وفّر شهرين)</p>
      <ul>
        <li>منتجات من غير حد</li>
        <li>من غير علامة ${BRAND}</li>
        <li>إحصائيات المبيعات وأكتر المنتجات طلباً</li>
        <li>الدفع بفودافون كاش أو إنستاباي</li>
      </ul>
      <a class="btn" href="${signupHref}">جرّبها ${config.trialDays} يوم ببلاش</a>
    </div>
  </div>
</section>

<section class="wrap section">
  <h2 class="section-title">ادعي صحابك واكسب</h2>
  <p class="center">كل صاحب محل يسجل من اللينك بتاعك ويشترك، بتاخد <b>شهر مجاني</b> على الباقة الاحترافية. مفيش حد أقصى.</p>
</section>

<section class="cta-final"><div class="wrap center">
  <h2>جاهز تبيع أونلاين النهارده؟</h2>
  <a class="btn btn-big btn-light" href="${signupHref}">اعمل متجرك دلوقتي، مجاناً</a>
</div></section>
</main>
<footer class="footer"><div class="wrap">© ${new Date().getFullYear()} ${BRAND}${config.supportWhatsapp ? html` · <a href="https://wa.me/${config.supportWhatsapp}">الدعم على واتساب</a>` : ''}</div></footer>`,
  });
}

function field({ label, name, value = '', type = 'text', required = true, hint = '', attrs = {} }) {
  const extra = Object.entries(attrs).map(([k, v]) => html` ${k}="${v}"`);
  return html`<label class="field"><span>${label}</span>
  <input type="${type}" name="${name}" value="${value}" ${required ? html`required` : ''}${extra}>
  ${hint ? html`<small class="muted">${hint}</small>` : ''}</label>`;
}

export function signupPage({ csrf, values = {}, errors = [], refSlug = '' }) {
  return page({
    title: `اعمل متجرك | ${BRAND}`,
    header: publicHeader(),
    body: html`<main class="wrap narrow">
  <h1>اعمل متجرك مجاناً</h1>
  <p class="muted">دقيقة واحدة وتبقى جاهز تستقبل طلبات.</p>
  ${errorBox(errors)}
  <form method="post" action="/signup" class="card form">
    ${csrfField(csrf)}
    <input type="hidden" name="ref" value="${refSlug}">
    ${field({ label: 'اسم المحل', name: 'store_name', value: values.store_name, attrs: { maxlength: 60, placeholder: 'مثلاً: حلويات أم محمد' } })}
    ${field({
      label: 'رابط المتجر (بالإنجليزي)', name: 'slug', value: values.slug,
      hint: 'هيبقى لينك متجرك كده: /s/الرابط. حروف إنجليزي صغيرة وأرقام وشَرطة بس.',
      attrs: { maxlength: 30, placeholder: 'om-mohamed-sweets', dir: 'ltr', autocapitalize: 'off', autocomplete: 'off' },
    })}
    ${field({ label: 'رقم الموبايل (هتدخل بيه)', name: 'phone', type: 'tel', value: values.phone, attrs: { inputmode: 'tel', placeholder: '01xxxxxxxxx', dir: 'ltr', autocomplete: 'tel' } })}
    ${field({ label: 'رقم الواتساب اللي هتوصلك عليه الطلبات', name: 'whatsapp', type: 'tel', value: values.whatsapp, required: false, hint: 'لو سبته فاضي هنستخدم رقم الموبايل.', attrs: { inputmode: 'tel', placeholder: '01xxxxxxxxx', dir: 'ltr' } })}
    ${field({ label: 'كلمة السر', name: 'password', type: 'password', hint: '8 حروف أو أرقام على الأقل.', attrs: { minlength: 8, autocomplete: 'new-password' } })}
    <button class="btn btn-block" type="submit">اعمل المتجر</button>
  </form>
  <p class="center">عندك حساب؟ <a href="/login">ادخل من هنا</a></p>
</main>`,
  });
}

export function loginPage({ csrf, values = {}, errors = [], config }) {
  return page({
    title: `تسجيل الدخول | ${BRAND}`,
    header: publicHeader(),
    body: html`<main class="wrap narrow">
  <h1>تسجيل الدخول</h1>
  ${errorBox(errors)}
  <form method="post" action="/login" class="card form">
    ${csrfField(csrf)}
    ${field({ label: 'رقم الموبايل', name: 'phone', type: 'tel', value: values.phone, attrs: { inputmode: 'tel', dir: 'ltr', autocomplete: 'tel' } })}
    ${field({ label: 'كلمة السر', name: 'password', type: 'password', attrs: { autocomplete: 'current-password' } })}
    <button class="btn btn-block" type="submit">دخول</button>
  </form>
  <p class="center">مالكش حساب؟ <a href="/signup">اعمل متجرك مجاناً</a></p>
  ${config.supportWhatsapp
    ? html`<p class="center muted small">نسيت كلمة السر؟ <a href="https://wa.me/${config.supportWhatsapp}">كلّمنا على واتساب</a> وهنساعدك.</p>`
    : ''}
</main>`,
  });
}

function productCard(p, open) {
  const initial = [...p.name][0] || '•';
  return html`<article class="product${p.available ? '' : ' is-out'}" data-id="${p.id}" data-name="${p.name}" data-price="${p.price}">
  ${p.image
    ? html`<img class="product-img" src="/uploads/${p.image}" alt="${p.name}" loading="lazy">`
    : html`<div class="product-img placeholder" aria-hidden="true">${initial}</div>`}
  <div class="product-body">
    <h3>${p.name}</h3>
    ${p.description ? html`<p class="muted small">${p.description}</p>` : ''}
    <div class="product-foot">
      <span class="price-tag">${formatMoney(p.price)}</span>
      ${p.available && open
        ? html`<div class="qty" data-qty-for="${p.id}">
            <button type="button" class="qty-btn" data-action="dec" aria-label="شيل واحد">−</button>
            <span class="qty-num">0</span>
            <button type="button" class="qty-btn" data-action="inc" aria-label="زوّد واحد">+</button>
          </div>`
        : p.available ? '' : html`<span class="badge">مش متاح دلوقتي</span>`}
    </div>
  </div>
</article>`;
}

/**
 * Group products by category, keeping the merchant's order (first product of
 * each category decides its position). Uncategorized products come last.
 */
export function groupByCategory(products) {
  const groups = new Map();
  for (const p of products) {
    const key = p.category || '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }
  const named = [...groups.entries()].filter(([k]) => k !== '').map(([name, items]) => ({ name, items }));
  const rest = groups.get('') || [];
  if (named.length === 0) return [{ name: '', items: rest }];
  if (rest.length) named.push({ name: 'منتجات تانية', items: rest });
  return named;
}

const SEARCH_THRESHOLD = 8;

function productsSection(products, open) {
  if (products.length === 0) return html`<p class="empty">المتجر لسه مافيهوش منتجات. ارجع تاني قريب!</p>`;
  const groups = groupByCategory(products);
  const hasCategories = groups.length > 1 || groups[0].name !== '';
  return html`
  ${products.length >= SEARCH_THRESHOLD
    ? html`<div class="store-search"><input type="search" id="product-search" placeholder="🔍 دوّر على منتج..." aria-label="دوّر على منتج"></div>`
    : ''}
  ${hasCategories
    ? html`<nav class="cat-nav" aria-label="الأقسام">${groups.map((g, i) => html`<a href="#cat-${i}">${g.name}</a>`)}</nav>`
    : ''}
  ${groups.map((g, i) => html`<section class="cat-section" id="cat-${i}">
    ${hasCategories ? html`<h2 class="cat-title">${g.name}</h2>` : ''}
    <div class="products">${g.items.map((p) => productCard(p, open))}</div>
  </section>`)}
  <p class="empty" id="no-results" hidden>مفيش منتجات بالاسم ده.</p>`;
}

export function storePage({ merchant, products, showBadge, storeUrl, ogImage }) {
  const initial = [...merchant.store_name][0] || '•';
  return page({
    title: merchant.store_name,
    description: merchant.description || `اطلب من ${merchant.store_name} أونلاين`,
    accent: merchant.accent,
    og: {
      title: merchant.store_name,
      description: merchant.description || `اطلب من ${merchant.store_name} أونلاين والطلب يوصل على واتساب`,
      url: storeUrl,
      image: ogImage,
    },
    scripts: ['/store.js?v=2'],
    body: html`<main class="store" data-slug="${merchant.slug}" data-delivery="${merchant.delivery_fee}">
  <header class="store-head"><div class="wrap">
    ${merchant.logo
      ? html`<img class="avatar avatar-img" src="/uploads/${merchant.logo}" alt="">`
      : html`<div class="avatar" aria-hidden="true">${initial}</div>`}
    <h1>${merchant.store_name}</h1>
    ${merchant.description ? html`<p class="store-desc">${merchant.description}</p>` : ''}
    ${merchant.delivery_fee > 0 ? html`<p class="small">🚚 التوصيل: ${formatMoney(merchant.delivery_fee)}</p>` : ''}
  </div></header>
  ${merchant.is_open ? '' : html`<div class="closed-banner">🔒 المحل مقفول دلوقتي ومش بياخد طلبات. تقدر تتفرج على المنتجات وترجع تطلب بعدين.</div>`}
  <div class="wrap">
    ${productsSection(products, Boolean(merchant.is_open))}
  </div>

  <div class="cart-bar" id="cart-bar" hidden>
    <div class="wrap cart-bar-inner">
      <span><b id="cart-count">0</b> منتج · <b id="cart-total">0</b></span>
      <button type="button" class="btn btn-light" id="open-checkout">كمّل الطلب</button>
    </div>
  </div>

  <dialog id="checkout" class="sheet">
    <form id="checkout-form" class="form" novalidate>
      <div class="sheet-head"><h2>طلبك</h2><button type="button" class="icon-btn" id="close-checkout" aria-label="اقفل">✕</button></div>
      <ul id="cart-lines" class="cart-lines"></ul>
      <div class="totals">
        <div><span>المنتجات</span><b id="sum-subtotal"></b></div>
        ${merchant.delivery_fee > 0 ? html`<div><span>التوصيل</span><b>${formatMoney(merchant.delivery_fee)}</b></div>` : ''}
        <div class="grand"><span>الإجمالي</span><b id="sum-total"></b></div>
      </div>
      <label class="field"><span>اسمك</span><input name="name" required maxlength="60" autocomplete="name"></label>
      <label class="field"><span>رقم موبايلك</span><input name="phone" type="tel" inputmode="tel" required dir="ltr" placeholder="01xxxxxxxxx" autocomplete="tel"></label>
      <label class="field"><span>العنوان</span><textarea name="address" required maxlength="300" rows="2" autocomplete="street-address"></textarea></label>
      <label class="field"><span>ملاحظات (اختياري)</span><textarea name="notes" maxlength="500" rows="2"></textarea></label>
      <p class="alert alert-error" id="checkout-error" hidden></p>
      <button class="btn btn-block btn-whatsapp" type="submit" id="submit-order">ابعت الطلب على واتساب</button>
      <p class="muted small center">هيتفتح واتساب والطلب مكتوب جاهز، اضغط إرسال بس.</p>
    </form>
  </dialog>

  ${showBadge
    ? html`<footer class="made-with"><a href="/?ref=${merchant.slug}">🛍️ اعمل متجر زي ده لمحلك مجاناً على ${BRAND}</a></footer>`
    : html`<footer class="made-with plain"></footer>`}
</main>`,
  });
}
