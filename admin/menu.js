/* RAAHA admin — Menu. One price per item, used on the menu page and the Coffee Cart sample menu. */
(function () {
  'use strict';
  var A = window.RAAHA_ADMIN, $ = A.$, el = A.el, C = A.content;
  var current = null;
  var BUILT_IN = {
    espresso: '/assets/images/web/raaha-coffee.webp', siglattes: '/assets/images/web/signature-latte.webp',
    matcha: '/assets/images/web/ceremonial-matcha.webp', tea: '/assets/images/web/raaha-matcha-chai.webp',
    refreshers: '/assets/images/web/refreshers-strawberry-lemonade.webp', bites: '/assets/images/web/pastries.webp'
  };

  function cats() { return C.list('menu_category').map(function (r) { return r.draft || {}; }); }

  function render() {
    var box = $('menu-editor'); box.textContent = '';
    var categories = cats();
    if (!current && categories.length) current = categories[0].slug;

    var tools = el('div', null, 'toolbar');
    var sel = el('select');
    categories.forEach(function (c) { var o = el('option', c.name + (c.visible === false ? ' (hidden)' : '')); o.value = c.slug; sel.appendChild(o); });
    sel.value = current;
    sel.addEventListener('change', function () { current = sel.value; render(); });
    tools.appendChild(A.field('Category', sel));
    box.appendChild(tools);

    box.appendChild(el('h2', 'Items'));
    var items = el('div'); box.appendChild(items);
    A.listEditor(items, {
      collection: 'menu_item',
      filter: function (v) { return v.category === current; },
      defaults: { name: '', category: current, price: null, description: '', available: true, visible: true, featured: false, cart_section: '', cart_label: '' },
      addLabel: 'Add item to this category',
      title: function (v) {
        return (v.name || '(new item)') + (v.price != null ? ' — $' + Number(v.price).toFixed(2) : '') +
          (v.visible === false ? ' · hidden' : '') + (v.available === false ? ' · unavailable' : '') + (v.featured ? ' · signature' : '');
      },
      fields: [
        { k: 'name', label: 'Name', required: true, max: 80 },
        { k: 'price', label: 'Price ($)', type: 'price', required: true },
        { k: 'description', label: 'Description (optional)', type: 'textarea', rows: 2, max: 300 },
        { k: 'category', label: 'Category', type: 'select', options: categories.map(function (c) { return [c.slug, c.name]; }) },
        { k: 'available', label: 'Available (off = shows “Unavailable”)', type: 'check' },
        { k: 'visible', label: 'Show on website', type: 'check' },
        { k: 'featured', label: 'Mark as signature', type: 'check' },
        { k: 'cart_section', label: 'Coffee Cart menu section (blank = not on cart menu)', max: 60 },
        { k: 'cart_label', label: 'Name on cart menu (blank = same name)', max: 80 }
      ]
    });

    box.appendChild(el('h2', 'Categories'));
    var cbox = el('div'); box.appendChild(cbox);
    A.listEditor(cbox, {
      collection: 'menu_category',
      defaults: { name: '', slug: '', nav_label: '', price_prefix: '', visible: true },
      addLabel: 'Add category',
      title: function (v) { return (v.name || '(new category)') + (v.visible === false ? ' · hidden' : ''); },
      check: function (v, row) {
        if (!v.slug) v.slug = (v.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        if (!/^[a-z0-9-]+$/.test(v.slug)) return 'Short code may only use lowercase letters, numbers and dashes.';
        var dup = C.list('menu_category').some(function (r) { return r.id !== row.id && r.draft && r.draft.slug === v.slug; });
        return dup ? 'Another category already uses that short code.' : null;
      },
      fields: [
        { k: 'name', label: 'Name', required: true, max: 60 },
        { k: 'nav_label', label: 'Menu tab label', max: 40 },
        { k: 'slug', label: 'Short code (used for links; avoid changing)', max: 40 },
        { k: 'price_prefix', label: 'Price prefix (e.g. “+” for add-ons)', max: 4 },
        { k: 'media_id', label: 'Category photo', type: 'photo', folder: 'menu', frame: 'menu',
          // photos built into the menu page (shown on the website when no photo is chosen here)
          builtIn: function (v) { return BUILT_IN[v.slug] || null; } },
        { k: 'visible', label: 'Show on website', type: 'check' }
      ]
    });
  }

  A.modules.push({ tab: 'menu', onShow: render });
})();
