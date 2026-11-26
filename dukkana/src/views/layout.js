import { html } from '../html.js';

export const BRAND = 'دكّانة';

export function page({
  title,
  body,
  description = 'اعمل متجر أونلاين لمحلك في دقيقتين، والطلبات توصلك على واتساب.',
  accent = 'green',
  og = null,
  scripts = [],
  header = null,
}) {
  return (
    '<!doctype html>' +
    html`<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${description}">
<meta name="theme-color" content="#16a34a">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/icon.svg">
<link rel="stylesheet" href="/style.css?v=5">
${og
  ? html`<meta property="og:type" content="website">
<meta property="og:title" content="${og.title}">
<meta property="og:description" content="${og.description}">
${og.url ? html`<meta property="og:url" content="${og.url}">` : ''}
${og.image ? html`<meta property="og:image" content="${og.image}">` : ''}`
  : ''}
</head>
<body class="accent-${accent}">
${header}
${body}
${scripts.map((src) => html`<script src="${src}" defer></script>`)}
</body>
</html>`
  );
}

export function csrfField(token) {
  return html`<input type="hidden" name="_csrf" value="${token}">`;
}

export function errorBox(errors) {
  if (!errors || errors.length === 0) return '';
  return html`<div class="alert alert-error" role="alert"><ul>${errors.map((e) => html`<li>${e}</li>`)}</ul></div>`;
}

export function notice(message, kind = 'success') {
  if (!message) return '';
  return html`<div class="alert alert-${kind}" role="status">${message}</div>`;
}

export function publicHeader() {
  return html`<header class="topbar"><div class="wrap topbar-inner">
  <a class="logo" href="/">🛍️ ${BRAND}</a>
  <nav class="topnav"><a href="/login">دخول</a><a class="btn btn-small" href="/signup">ابدأ مجاناً</a></nav>
</div></header>`;
}

export function simplePage({ title, message, linkHref = '/', linkText = 'الصفحة الرئيسية', status = '' }) {
  return page({
    title: `${title} | ${BRAND}`,
    header: publicHeader(),
    body: html`<main class="wrap narrow center-page">
  ${status ? html`<p class="big-status">${status}</p>` : ''}
  <h1>${title}</h1>
  <p>${message}</p>
  <p><a class="btn" href="${linkHref}">${linkText}</a></p>
</main>`,
  });
}
