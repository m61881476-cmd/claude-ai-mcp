import { html } from '../html.js';
import { formatDate, formatDateTime, formatMoney } from '../util.js';
import { BRAND, page, csrfField, errorBox, notice } from './layout.js';

function adminPage({ title, body, csrf }) {
  return page({
    title: `${title} | إدارة ${BRAND}`,
    header: html`<header class="topbar"><div class="wrap topbar-inner"><a class="logo" href="/admin">🛠️ إدارة ${BRAND}</a>
    ${csrf ? html`<form method="post" action="/admin/logout" class="inline">${csrfField(csrf)}<button class="link-btn">خروج</button></form>` : ''}</div></header>`,
    scripts: ['/dash.js?v=1'],
    body: html`<main class="wrap dash">${body}</main>`,
  });
}

export function adminLoginPage({ csrf, errors = [] }) {
  return adminPage({
    title: 'دخول الإدارة',
    body: html`<div class="narrow"><h1>دخول الإدارة</h1>${errorBox(errors)}
<form method="post" action="/admin/login" class="card form">${csrfField(csrf)}
<label class="field"><span>كلمة سر الإدارة</span><input type="password" name="password" required autocomplete="current-password"></label>
<button class="btn btn-block">دخول</button></form></div>`,
  });
}

const ADMIN_FLASH = {
  approved: 'الدفع اتقبل والباقة اتفعّلت.',
  rejected: 'الدفع اترفض.',
  extended: 'المدة اتمدّت.',
};

export function adminHomePage({ csrf, stats, pending, merchants, q, msg, tempPassword, now }) {
  return adminPage({
    title: 'لوحة الإدارة',
    csrf,
    body: html`${notice(ADMIN_FLASH[msg])}
${tempPassword
  ? html`<div class="alert alert-success">كلمة السر المؤقتة لـ <b>${tempPassword.store}</b>: <code dir="ltr">${tempPassword.password}</code>. ابعتهاله ويغيّرها من الإعدادات. مش هتظهر تاني.</div>`
  : ''}
<section class="stats">
  <div class="stat"><b>${stats.merchants}</b><span>متجر</span></div>
  <div class="stat"><b>${stats.signups7}</b><span>تسجيل آخر 7 أيام</span></div>
  <div class="stat"><b>${stats.paidActive}</b><span>مشترك دافع (شغال)</span></div>
  <div class="stat"><b>${formatMoney(stats.revenue30)}</b><span>دخل آخر 30 يوم</span></div>
  <div class="stat"><b>${formatMoney(stats.revenueTotal)}</b><span>إجمالي الدخل</span></div>
  <div class="stat"><b>${stats.orders30}</b><span>طلبات في كل المتاجر (30 يوم)</span></div>
</section>

<section class="card">
  <h2>مدفوعات مستنية مراجعة (${pending.length})</h2>
  <p class="muted small">قبل ما تقبل: اتأكد إن التحويل وصلك فعلاً بنفس المبلغ ورقم العملية.</p>
  ${pending.length === 0
    ? html`<p class="muted">مفيش حاجة مستنية.</p>`
    : html`<div class="orders">${pending.map((p) => html`<article class="order">
      <header><b>#${p.id}</b> · ${formatDateTime(p.created_at)}</header>
      <p><b>${p.store_name}</b> (<span dir="ltr">${p.phone}</span>) · /s/${p.slug}</p>
      <p>${p.plan === 'yearly' ? 'سنوي' : 'شهري'} · <b>${formatMoney(p.amount)}</b> · ${p.method === 'instapay' ? 'إنستاباي' : 'فودافون كاش'}</p>
      <p class="small">من: <code dir="ltr">${p.sender}</code> · رقم العملية: <code dir="ltr">${p.reference}</code></p>
      <div class="row-actions">
        <form method="post" action="/admin/payments/${p.id}/approve" class="inline" data-confirm="اتأكدت إن التحويل وصل؟">${csrfField(csrf)}<button class="btn btn-small">قبول وتفعيل</button></form>
        <form method="post" action="/admin/payments/${p.id}/reject" class="inline" data-confirm="ترفض الدفع ده؟">${csrfField(csrf)}<button class="btn btn-small btn-danger">رفض</button></form>
      </div>
    </article>`)}</div>`}
</section>

<section class="card">
  <h2>المتاجر</h2>
  <form method="get" action="/admin" class="copy-row"><input name="q" value="${q}" placeholder="دوّر بالرقم أو الرابط أو الاسم"><button class="btn btn-small">دوّر</button></form>
  <table class="table"><thead><tr><th>المتجر</th><th>الموبايل</th><th>الباقة لحد</th><th>اتسجل</th><th></th></tr></thead><tbody>
  ${merchants.map((m) => html`<tr>
    <td><a href="/s/${m.slug}" target="_blank" rel="noopener">${m.store_name}</a><br><small class="muted">/s/${m.slug} · ${m.products} منتج</small></td>
    <td dir="ltr">${m.phone}</td>
    <td>${m.plan_expires_at && m.plan_expires_at > now ? formatDate(m.plan_expires_at) : html`<span class="muted">مجاني</span>`}</td>
    <td>${formatDate(m.created_at)}</td>
    <td class="row-actions">
      <form method="post" action="/admin/merchants/${m.id}/extend" class="inline">${csrfField(csrf)}<input type="hidden" name="days" value="30"><button class="btn btn-small btn-ghost">+30 يوم</button></form>
      <form method="post" action="/admin/merchants/${m.id}/reset-password" class="inline" data-confirm="تعمل كلمة سر جديدة للمتجر ده؟">${csrfField(csrf)}<button class="btn btn-small btn-ghost">كلمة سر جديدة</button></form>
    </td></tr>`)}
  </tbody></table>
  ${merchants.length === 100 ? html`<p class="muted small">بيظهر أول 100 نتيجة بس. استخدم البحث.</p>` : ''}
</section>`,
  });
}
