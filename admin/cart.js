/* RAAHA admin — Coffee Cart selection. The same menu items (same names and prices) as the full menu;
   here you choose which ones the cart offers, under which heading, and their name on the cart menu.
   Nothing here creates prices or packages: event pricing stays custom-quoted. */
(function () {
  'use strict';
  var A = window.RAAHA_ADMIN, $ = A.$, el = A.el, C = A.content;

  function money(v, prefix) { return v == null || v === '' ? '—' : (prefix || '') + '$' + Number(v).toFixed(2); }

  function saveItem(r, nv, msg) {
    return A.saveLive([r], function () { return C.saveDraft(r, nv); }).then(function (res) {
      if (res && res.cancelled) return;
      A.toast(msg); render();
    }).catch(function (e) { A.toast('Not live: ' + e.message, true); render(); });
  }

  function render() {
    var box = $('cart-editor'); box.textContent = '';
    var cats = C.list('menu_category').map(function (r) { return r.draft || {}; });
    var catBy = {}; cats.forEach(function (c) { catBy[c.slug] = c; });
    var items = C.list('menu_item');
    var on = items.filter(function (r) { return A.onCart(r.draft || {}); });
    var off = items.filter(function (r) { return !A.onCart(r.draft || {}); });

    // --- on the cart, grouped exactly as the Coffee Cart page shows them ---
    var groups = [];
    on.forEach(function (r) {
      var name = (r.draft || {}).cart_section || 'Coffee Cart';
      var g = groups.filter(function (x) { return x.name === name; })[0];
      if (!g) { g = { name: name, rows: [] }; groups.push(g); }
      g.rows.push(r);
    });
    var head = el('div', null, 'cart-head');
    head.appendChild(el('h2', 'On the Coffee Cart menu (' + on.length + ')'));
    head.appendChild(el('p', 'Shown on the Coffee Cart page in this order. Items hidden on the website (Menu → Show off) are not shown anywhere.', 'muted small'));
    box.appendChild(head);
    if (!groups.length) box.appendChild(el('p', 'No items are on the Coffee Cart menu.', 'muted'));
    groups.forEach(function (g) {
      var sec = el('section', null, 'cart-group');
      sec.appendChild(el('h3', g.name));
      g.rows.forEach(function (r) { sec.appendChild(onRow(r, catBy)); });
      box.appendChild(sec);
    });

    // --- everything else, by menu category ---
    var offBox = el('details', null, 'cart-off');
    offBox.appendChild(el('summary', 'Not on the Coffee Cart (' + off.length + ')'));
    cats.forEach(function (c) {
      var mine = off.filter(function (r) { return (r.draft || {}).category === c.slug; });
      if (!mine.length) return;
      offBox.appendChild(el('h3', c.name || c.slug));
      mine.forEach(function (r) { offBox.appendChild(offRow(r, catBy)); });
    });
    box.appendChild(offBox);
  }

  function onRow(r, catBy) {
    var v = Object.assign({}, r.draft || {});
    var row = el('div', null, 'cart-row');
    var name = el('div', null, 'cart-name');
    name.appendChild(el('strong', v.cart_label || v.name || '(unnamed)'));
    var meta = 'Menu item: ' + (v.name || '') + ' · ' + money(v.price, (catBy[v.category] || {}).price_prefix) +
      (v.available === false ? ' · Unavailable' : '') + (v.visible === false ? ' · Hidden on the website' : '');
    name.appendChild(el('span', meta, 'muted small'));
    row.appendChild(name);

    var edit = el('div', null, 'cart-edit');
    var value = Object.assign({}, v);
    var save = el('button', 'Save', 'primary'); save.type = 'button'; save.disabled = true;
    edit.appendChild(A.buildField({ k: 'cart_section', label: 'Heading', type: 'cartsection' }, value, function () { save.disabled = false; }));
    edit.appendChild(A.buildField({ k: 'cart_label', label: 'Name on the cart menu (blank = same name)', max: 80 }, value, function () { save.disabled = false; }));
    row.appendChild(edit);

    var acts = el('div', null, 'cart-acts');
    save.addEventListener('click', function () {
      ['cart_section', 'cart_label'].forEach(function (k) { if (typeof value[k] === 'string') value[k] = value[k].trim(); });
      if (!value.cart_section) { A.toast('Choose a heading for the cart menu.', true); return; }
      value.cart = true;
      save.disabled = true;
      saveItem(r, value, 'Saved — live on the Coffee Cart page.');
    });
    var offBtn = el('button', 'Remove from cart'); offBtn.type = 'button';
    offBtn.addEventListener('click', function () {
      var nv = Object.assign({}, r.draft || {}); A.setOnCart(nv, false);
      offBtn.disabled = true;
      saveItem(r, nv, '“' + (v.name || 'Item') + '” removed from the Coffee Cart menu.');
    });
    acts.appendChild(save); acts.appendChild(offBtn);
    row.appendChild(acts);
    return row;
  }

  function offRow(r, catBy) {
    var v = r.draft || {};
    var row = el('div', null, 'cart-row is-off');
    var name = el('div', null, 'cart-name');
    name.appendChild(el('strong', v.name || '(unnamed)'));
    name.appendChild(el('span', money(v.price, (catBy[v.category] || {}).price_prefix) + (v.visible === false ? ' · Hidden on the website' : ''), 'muted small'));
    row.appendChild(name);
    var acts = el('div', null, 'cart-acts');
    var onBtn = el('button', 'Add to cart'); onBtn.type = 'button';
    onBtn.addEventListener('click', function () {
      var nv = Object.assign({}, v); A.setOnCart(nv, true);
      onBtn.disabled = true;
      saveItem(r, nv, '“' + (v.name || 'Item') + '” added to the Coffee Cart menu under “' + nv.cart_section + '”.');
    });
    acts.appendChild(onBtn);
    row.appendChild(acts);
    return row;
  }

  A.modules.push({ tab: 'cart', onShow: render });
})();
