// Storefront cart. Prices shown here are for display only: the server recomputes
// every total from the database when the order is placed.
(function () {
  'use strict';
  var root = document.querySelector('main.store');
  if (!root) return;

  var slug = root.getAttribute('data-slug');
  var delivery = Number(root.getAttribute('data-delivery')) || 0;
  var minOrder = Number(root.getAttribute('data-min-order')) || 0;
  var applied = null; // { code, label, discount } from the server
  var storageKey = 'dukkana-cart:' + slug;

  var products = {};
  document.querySelectorAll('.product').forEach(function (el) {
    products[el.getAttribute('data-id')] = {
      name: el.getAttribute('data-name'),
      price: Number(el.getAttribute('data-price')),
      el: el,
    };
  });

  var cart = {};
  try {
    var saved = JSON.parse(localStorage.getItem(storageKey) || '{}');
    Object.keys(saved).forEach(function (id) {
      var q = Number(saved[id]);
      // Drop items that no longer exist or are unavailable.
      if (products[id] && products[id].el.querySelector('.qty') && q > 0 && q <= 99) cart[id] = Math.floor(q);
    });
  } catch (e) {
    cart = {};
  }

  function save() {
    try {
      localStorage.setItem(storageKey, JSON.stringify(cart));
    } catch (e) { /* private mode: cart just won't persist */ }
  }

  function money(piasters) {
    var egp = piasters / 100;
    var text = piasters % 100 === 0
      ? egp.toLocaleString('en-US', { maximumFractionDigits: 0 })
      : egp.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return text + ' ج.م';
  }

  function subtotal() {
    return Object.keys(cart).reduce(function (sum, id) {
      return sum + products[id].price * cart[id];
    }, 0);
  }

  var bar = document.getElementById('cart-bar');
  var countEl = document.getElementById('cart-count');
  var totalEl = document.getElementById('cart-total');

  function render() {
    var count = 0;
    Object.keys(products).forEach(function (id) {
      var q = cart[id] || 0;
      count += q;
      var box = products[id].el.querySelector('.qty');
      if (box) {
        box.querySelector('.qty-num').textContent = String(q);
        box.classList.toggle('has-items', q > 0);
      }
    });
    var sub = subtotal();
    countEl.textContent = String(count);
    totalEl.textContent = money(sub);
    bar.hidden = count === 0;
    document.body.classList.toggle('has-cart', count > 0);
    renderLines();
  }

  function change(id, delta) {
    var q = (cart[id] || 0) + delta;
    if (q <= 0) delete cart[id];
    else cart[id] = Math.min(q, 99);
    save();
    render();
    if (applied) requote();
  }

  root.addEventListener('click', function (e) {
    var btn = e.target.closest('.qty-btn');
    if (!btn) return;
    var id = btn.closest('[data-qty-for]').getAttribute('data-qty-for');
    change(id, btn.getAttribute('data-action') === 'inc' ? 1 : -1);
  });

  var dialog = document.getElementById('checkout');
  var linesEl = document.getElementById('cart-lines');
  var form = document.getElementById('checkout-form');
  var errorEl = document.getElementById('checkout-error');
  var submitBtn = document.getElementById('submit-order');

  function renderLines() {
    linesEl.textContent = '';
    Object.keys(cart).forEach(function (id) {
      var li = document.createElement('li');
      var name = document.createElement('span');
      name.textContent = cart[id] + ' × ' + products[id].name;
      var price = document.createElement('b');
      price.textContent = money(products[id].price * cart[id]);
      var controls = document.createElement('span');
      controls.className = 'line-controls';
      [['−', -1], ['+', 1]].forEach(function (pair) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'qty-btn';
        b.textContent = pair[0];
        b.addEventListener('click', function () {
          change(id, pair[1]);
          if (Object.keys(cart).length === 0) dialog.close();
        });
        controls.appendChild(b);
      });
      li.appendChild(name);
      li.appendChild(controls);
      li.appendChild(price);
      linesEl.appendChild(li);
    });
    renderTotals();
  }

  function fulfillment() {
    var checked = form.querySelector('input[name=fulfillment]:checked');
    return checked ? checked.value : 'delivery';
  }

  function renderTotals() {
    var sub = subtotal();
    var fee = fulfillment() === 'delivery' ? delivery : 0;
    var discount = applied ? applied.discount : 0;
    document.getElementById('sum-subtotal').textContent = money(sub);
    document.getElementById('row-discount').hidden = !discount;
    document.getElementById('sum-discount').textContent = '-' + money(discount);
    document.getElementById('row-delivery').hidden = !fee;
    document.getElementById('sum-total').textContent = money(sub - discount + fee);
    var tooSmall = sub > 0 && sub < minOrder;
    var note = document.getElementById('min-order-note');
    note.hidden = !tooSmall;
    if (tooSmall) note.textContent = 'أقل قيمة للطلب ' + money(minOrder) + '. ضيف بـ ' + money(minOrder - sub) + ' كمان.';
    submitBtn.disabled = tooSmall;
    var pickup = fulfillment() === 'pickup';
    document.getElementById('address-field').hidden = pickup;
  }

  // ---- Coupons -------------------------------------------------------------
  var couponInput = document.getElementById('coupon-input');
  var couponStatus = document.getElementById('coupon-status');

  function items() {
    return Object.keys(cart).map(function (id) { return { id: Number(id), qty: cart[id] }; });
  }

  function quote(code) {
    return fetch('/s/' + encodeURIComponent(slug) + '/quote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: items(), coupon: code, fulfillment: fulfillment() }),
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        if (!res.ok) throw new Error(body.error || 'حصلت مشكلة، جرّب تاني.');
        return body;
      });
    });
  }

  function showCoupon(ok, text) {
    couponStatus.hidden = false;
    couponStatus.className = 'small ' + (ok ? 'coupon-ok' : 'coupon-bad');
    couponStatus.textContent = text;
  }

  function requote() {
    if (!applied || Object.keys(cart).length === 0) return;
    var code = applied.code;
    quote(code).then(function (q) {
      applied = { code: code, label: q.coupon.label, discount: q.discount };
      showCoupon(true, '✓ ' + q.coupon.label);
      renderTotals();
    }, function (err) {
      applied = null;
      showCoupon(false, err.message);
      renderTotals();
    });
  }

  if (couponInput) {
    document.getElementById('apply-coupon').addEventListener('click', function () {
      var code = couponInput.value.trim();
      if (!code) return;
      quote(code).then(function (q) {
        applied = { code: q.coupon.code, label: q.coupon.label, discount: q.discount };
        showCoupon(true, '✓ ' + q.coupon.label + ' (وفّرت ' + money(q.discount) + ')');
        renderTotals();
      }, function (err) {
        applied = null;
        showCoupon(false, err.message);
        renderTotals();
      });
    });
    couponInput.addEventListener('input', function () {
      if (applied && couponInput.value.trim().toUpperCase() !== applied.code) {
        applied = null;
        couponStatus.hidden = true;
        renderTotals();
      }
    });
  }

  form.addEventListener('change', function (e) {
    if (e.target.name === 'fulfillment') {
      renderTotals();
      if (applied) requote();
    }
  });

  // Remember the customer's details for next time (on their own device only).
  var profileKey = 'dukkana-customer';
  try {
    var profile = JSON.parse(localStorage.getItem(profileKey) || '{}');
    ['name', 'phone', 'address'].forEach(function (k) {
      if (typeof profile[k] === 'string' && form.elements[k]) form.elements[k].value = profile[k];
    });
  } catch (e) { /* ignore */ }

  document.getElementById('open-checkout').addEventListener('click', function () {
    errorEl.hidden = true;
    renderLines();
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  });
  document.getElementById('close-checkout').addEventListener('click', function () {
    dialog.close();
  });

  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.hidden = false;
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    errorEl.hidden = true;
    var data = {
      name: form.elements.name.value,
      phone: form.elements.phone.value,
      address: form.elements.address.value,
      notes: form.elements.notes.value,
      fulfillment: fulfillment(),
      coupon: applied ? applied.code : '',
      items: items(),
    };
    if (data.items.length === 0) return showError('السلة فاضية.');
    if (data.name.trim().length < 2) return showError('اكتب اسمك.');
    if (data.fulfillment === 'delivery' && data.address.trim().length < 5) return showError('اكتب العنوان بالتفصيل.');

    submitBtn.disabled = true;
    submitBtn.textContent = 'لحظة...';
    fetch('/s/' + encodeURIComponent(slug) + '/order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (body) {
          return { ok: res.ok, body: body };
        });
      })
      .then(function (r) {
        if (!r.ok || !r.body.whatsappUrl) {
          throw new Error(r.body.error || 'حصلت مشكلة، جرّب تاني.');
        }
        try {
          localStorage.setItem(profileKey, JSON.stringify({ name: data.name, phone: data.phone, address: data.address }));
        } catch (err) { /* ignore */ }
        cart = {};
        applied = null;
        if (couponInput) { couponInput.value = ''; couponStatus.hidden = true; }
        save();
        render();
        form.elements.notes.value = '';
        dialog.close();
        window.location.href = r.body.whatsappUrl;
      })
      .catch(function (err) {
        showError(err && err.message ? err.message : 'مفيش إنترنت أو حصلت مشكلة، جرّب تاني.');
      })
      .then(function () {
        submitBtn.disabled = false;
        submitBtn.textContent = 'ابعت الطلب على واتساب';
        renderTotals();
      });
  });

  // Product search: forgiving Arabic matching (أ/إ/آ = ا، ة = ه، ى = ي، no diacritics).
  function normalize(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/[ً-ٰٟـ]/g, '')
      .replace(/[أإآٱ]/g, 'ا')
      .replace(/ة/g, 'ه')
      .replace(/ى/g, 'ي')
      .replace(/\s+/g, ' ')
      .trim();
  }
  var search = document.getElementById('product-search');
  if (search) {
    var noResults = document.getElementById('no-results');
    var catNav = document.querySelector('.cat-nav');
    search.addEventListener('input', function () {
      var q = normalize(search.value);
      var anyVisible = false;
      document.querySelectorAll('.cat-section').forEach(function (section) {
        var visibleInSection = 0;
        section.querySelectorAll('.product').forEach(function (el) {
          var match = !q || normalize(el.getAttribute('data-name')).indexOf(q) !== -1;
          el.hidden = !match;
          if (match) visibleInSection++;
        });
        section.hidden = visibleInSection === 0;
        if (visibleInSection) anyVisible = true;
      });
      noResults.hidden = anyVisible;
      if (catNav) catNav.hidden = Boolean(q);
    });
  }

  render();
})();
