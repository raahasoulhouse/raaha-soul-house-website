/* RAAHA admin — Menu. One list of items with one price each, used on the Menu page and the Coffee Cart.
   Each category card holds its photo and settings, its items, and their availability switches. */
(function () {
  'use strict';
  var A = window.RAAHA_ADMIN, $ = A.$, el = A.el, C = A.content;

  // Photos built into the menu page (shown on the website when no photo is chosen here)
  var BUILT_IN = {
    espresso: '/assets/images/web/raaha-coffee.webp', siglattes: '/assets/images/web/signature-latte.webp',
    matcha: '/assets/images/web/ceremonial-matcha.webp', tea: '/assets/images/web/raaha-matcha-chai.webp',
    refreshers: '/assets/images/web/refreshers-strawberry-lemonade.webp', bites: '/assets/images/web/pastries.webp'
  };

  // ---------- Coffee Cart rule (same as the public site) ----------
  // An item switched on/off here carries `cart: true|false`. Items never switched keep the original rule:
  // on the cart when they have a Coffee Cart heading. So the existing cart menu is unchanged until you change it.
  A.onCart = function (v) { return v.cart === true || (v.cart == null && !!v.cart_section); };
  A.cartSections = function () {
    var names = [];
    C.list('menu_item').forEach(function (r) {
      var s = r.draft && r.draft.cart_section;
      if (s && names.indexOf(s) === -1) names.push(s);
    });
    return names;
  };
  // Turning an item on: keep its heading, or use the heading most used by its category, else the first heading
  A.defaultCartSection = function (v) {
    if (v.cart_section) return v.cart_section;
    var count = {};
    C.list('menu_item').forEach(function (r) {
      var d = r.draft || {};
      if (d.category === v.category && d.cart_section && A.onCart(d)) count[d.cart_section] = (count[d.cart_section] || 0) + 1;
    });
    var best = Object.keys(count).sort(function (a, b) { return count[b] - count[a]; })[0];
    return best || A.cartSections()[0] || 'Coffee Cart';
  };
  A.setOnCart = function (v, on) {
    v.cart = !!on;
    if (on) v.cart_section = A.defaultCartSection(v);
  };

  var ITEM_QUICK = [
    { label: 'Show', isOn: function (v) { return v.visible !== false; }, apply: function (v, on) { v.visible = on; } },
    { label: 'Available', isOn: function (v) { return v.available !== false; }, apply: function (v, on) { v.available = on; } },
    { label: 'Signature', isOn: function (v) { return !!v.featured; }, apply: function (v, on) { v.featured = on; } },
    { label: 'On Coffee Cart', isOn: function (v) { return A.onCart(v); }, apply: function (v, on) { A.setOnCart(v, on); } }
  ];

  function itemFields(categories) {
    return [
      { k: 'name', label: 'Name', required: true, max: 80 },
      { k: 'price', label: 'Price ($)', type: 'price', required: true },
      { k: 'description', label: 'Description (optional)', type: 'textarea', rows: 2, max: 300 },
      { k: 'category', label: 'Category', type: 'select', options: categories.map(function (c) { return [c.slug, c.name]; }) },
      { k: 'visible', label: 'Show on the website', type: 'check' },
      { k: 'available', label: 'Available (off = shows “Unavailable”)', type: 'check' },
      { k: 'featured', label: 'Mark as signature', type: 'check' },
      { k: 'cart', label: 'On the Coffee Cart menu', type: 'check', isOn: A.onCart },
      { k: 'cart_section', label: 'Coffee Cart menu heading', type: 'cartsection' },
      { k: 'cart_label', label: 'Name on the Coffee Cart menu (blank = same name)', max: 80 }
    ];
  }
  function itemTitle(v) {
    return (v.name || '(new item)') + (v.price != null ? ' — $' + Number(v.price).toFixed(2) : '');
  }
  function checkItem(v) {
    if (v.cart === true && !v.cart_section) v.cart_section = A.defaultCartSection(v);
    return null;
  }

  var openCats = {};
  function render() {
    var box = $('menu-editor');
    // remember which category cards are open across re-renders
    Array.prototype.forEach.call(box.querySelectorAll('details.cat-card'), function (d) { openCats[d.dataset.id] = d.open; });
    box.textContent = '';
    var rows = C.list('menu_category');
    var categories = rows.map(function (r) { return r.draft || {}; });
    var items = C.list('menu_item');

    rows.forEach(function (r, idx) {
      var cat = r.draft || {};
      var mine = items.filter(function (i) { return (i.draft || {}).category === cat.slug; });
      var onCartCount = mine.filter(function (i) { return A.onCart(i.draft || {}); }).length;
      var card = el('details', null, 'cat-card'); card.dataset.id = r.id;
      card.open = openCats[r.id] != null ? openCats[r.id] : idx === 0;
      var sum = el('summary');
      sum.appendChild(el('span', cat.name || '(new category)', 'cat-name'));
      sum.appendChild(el('span', mine.length + ' item' + (mine.length === 1 ? '' : 's'), 'badge'));
      if (onCartCount) sum.appendChild(el('span', onCartCount + ' on Coffee Cart', 'badge cart'));
      if (cat.visible === false) sum.appendChild(el('span', 'Hidden', 'badge draft'));
      sum.appendChild(A.draftBadge(r));
      card.appendChild(sum);

      // --- category settings: name, tab label, photo, visibility ---
      var setBox = el('div', null, 'cat-settings');
      setBox.appendChild(el('h3', 'Category settings'));
      var value = Object.assign({}, cat);
      var save = el('button', 'Save category', 'primary'); save.type = 'button'; save.disabled = true;
      var grid = el('div', null, 'grid');
      var defs = [
        { k: 'name', label: 'Name', required: true, max: 60 },
        { k: 'nav_label', label: 'Menu tab label', max: 40 },
        { k: 'price_prefix', label: 'Price prefix (e.g. “+” for add-ons)', max: 4 },
        { k: 'visible', label: 'Show this category on the website', type: 'check' },
        { k: 'media_id', label: 'Category photo', type: 'photo', folder: 'menu', frame: 'menu', builtIn: function (v) { return BUILT_IN[v.slug] || null; } }
      ];
      defs.forEach(function (f) { grid.appendChild(A.buildField(f, value, function () { save.disabled = false; })); });
      setBox.appendChild(grid);
      var acts = el('div', null, 'row-actions');
      save.addEventListener('click', function () {
        Object.keys(value).forEach(function (k) { if (typeof value[k] === 'string') value[k] = value[k].trim(); });
        if (!value.name) { A.toast('Category name is required.', true); return; }
        if (value.media_id && !String(value.alt || '').trim()) { A.toast('Category photo: please add a short photo description.', true); return; }
        save.disabled = true; save.textContent = 'Saving…';
        A.saveLive([r], function () { return C.saveDraft(r, value); }).then(function (res) {
          save.textContent = 'Save category';
          if (res && res.cancelled) { save.disabled = false; return; }
          A.toast('Category saved — live on the website.'); render();
        }).catch(function (e) { save.textContent = 'Save category'; save.disabled = false; A.toast('Saved, but not live yet: ' + e.message, true); render(); });
      });
      var up = el('button', '↑ Move category up'); up.type = 'button'; up.disabled = idx === 0;
      var dn = el('button', '↓ Move down'); dn.type = 'button'; dn.disabled = idx === rows.length - 1;
      [[up, -1], [dn, 1]].forEach(function (p) {
        p[0].addEventListener('click', function () {
          C.move(r, p[1]).then(function () { A.toast('Category order updated on the website.'); render(); })
            .catch(function (e) { A.toast('Could not reorder: ' + e.message, true); });
        });
      });
      acts.appendChild(save); acts.appendChild(up); acts.appendChild(dn);
      if (!mine.length) {
        var rm = el('button', 'Remove empty category', 'link'); rm.type = 'button';
        rm.addEventListener('click', function () {
          if (!confirm('Remove the empty category “' + (cat.name || '') + '” from the website?')) return;
          A.saveLive([r], function () { return C.remove(r); }).then(function (res) { if (!(res && res.cancelled)) { A.toast('Category removed.'); render(); } })
            .catch(function (e) { A.toast(e.message, true); render(); });
        });
        acts.appendChild(rm);
      }
      setBox.appendChild(acts);
      card.appendChild(setBox);

      // --- items in this category, with one-click availability switches ---
      var itemsHead = el('h3', 'Items');
      card.appendChild(itemsHead);
      card.appendChild(el('p', 'Switches: Show (on the website) · Available · Signature · On Coffee Cart. Each click updates the live website. Open an item to edit its name, price or cart details.', 'muted small'));
      var ib = el('div'); card.appendChild(ib);
      A.listEditor(ib, {
        collection: 'menu_item',
        filter: function (v) { return v.category === cat.slug; },
        defaults: { name: '', category: cat.slug, price: null, description: '', available: true, visible: true, featured: false },
        addLabel: 'Add an item to ' + (cat.name || 'this category'),
        title: itemTitle,
        quick: ITEM_QUICK,
        check: checkItem,
        onChange: render,
        fields: itemFields(categories)
      });
      $('menu-editor').appendChild(card);
    });

    // --- new category ---
    var add = el('button', 'Add a category'); add.type = 'button';
    add.addEventListener('click', function () {
      var name = (prompt('Name of the new category (for example “Seasonal Drinks”):') || '').trim().slice(0, 60);
      if (!name) return;
      var slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'category';
      if (categories.some(function (c) { return c.slug === slug; })) { A.toast('A category with that name already exists.', true); return; }
      C.add('menu_category', { name: name, slug: slug, nav_label: name, price_prefix: '', visible: true }).then(function (row) {
        openCats[row.id] = true; render();
        A.toast('Category added. It appears on the website once you Save it (with at least one item).');
      }).catch(function (e) { A.toast(e.message, true); });
    });
    $('menu-editor').appendChild(add);
  }

  A.modules.push({ tab: 'menu', onShow: render });
})();
