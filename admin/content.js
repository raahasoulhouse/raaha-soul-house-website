/* RAAHA admin — Website content: text, photos, buttons, section visibility and lists.
   The page layout is fixed; only the words, photos, links and on/off switches are editable.
   Also provides the shared field + list editors used by the Menu and Events tabs. */
(function () {
  'use strict';
  var A = window.RAAHA_ADMIN, $ = A.$, el = A.el, C = A.content;

  // ---------- shared field builder ----------
  // def: {k, label, type: text|textarea|number|price|check|select|date|photo|link, options, max, folder, help}
  A.buildField = function (def, value, onDirty) {
    var v = value[def.k], input, wrap;
    if (def.type === 'photo') {
      wrap = el('div', null, 'wide field');
      wrap.appendChild(el('span', def.label, 'label'));
      wrap.appendChild(A.photoField(value, def.folder, function (nv) {
        ['media_id', 'alt'].concat(A.POS_KEYS).forEach(function (k) { if (k in nv) value[k] = nv[k]; else delete value[k]; });
        alt.value = value.alt || '';
        onDirty();
        if (nv._focusAlt) { alt.focus(); }
      }, { frame: def.frame || def.key, builtIn: typeof def.builtIn === 'function' ? def.builtIn(value) : null, label: def.label }));
      var alt = A.input('text', value.alt, { maxlength: 300, placeholder: 'Describe the photo (alt text)' });
      alt.addEventListener('input', function () { value.alt = alt.value; onDirty(); });
      wrap.appendChild(A.field('Photo description (alt text)', alt));
      return wrap;
    }
    if (def.type === 'check') {
      input = A.input('checkbox'); input.checked = v !== false;
      input.addEventListener('change', function () { value[def.k] = input.checked; onDirty(); });
      wrap = el('label', null, 'check inline'); wrap.appendChild(input); wrap.appendChild(document.createTextNode(' ' + def.label));
      return wrap;
    }
    if (def.type === 'select') {
      input = el('select');
      def.options.forEach(function (o) { var op = el('option', o[1]); op.value = o[0]; input.appendChild(op); });
      input.value = v == null ? def.options[0][0] : v;
      if (v == null) value[def.k] = input.value;
    } else if (def.type === 'textarea') {
      input = A.input('textarea', v, { rows: def.rows || 4, maxlength: def.max || 3000 });
    } else if (def.type === 'price') {
      input = A.input('number', v, { min: 0, max: 1000, step: '0.01', inputmode: 'decimal' });
    } else {
      input = A.input(def.type === 'date' ? 'date' : 'text', v, { maxlength: def.max || 300 });
    }
    input.addEventListener(def.type === 'select' ? 'change' : 'input', function () {
      value[def.k] = def.type === 'price' ? (input.value === '' ? null : Math.round(Number(input.value) * 100) / 100) : input.value;
      onDirty();
    });
    wrap = A.field(def.label, input, def.type === 'textarea' || def.wide);
    if (def.help) wrap.appendChild(el('span', def.help, 'muted small'));
    return wrap;
  };

  function validate(defs, value) {
    for (var i = 0; i < defs.length; i++) {
      var d = defs[i], v = value[d.k];
      if (d.required && (v == null || String(v).trim() === '')) return d.label + ' is required.';
      if (d.type === 'price' && v != null && (isNaN(v) || v < 0)) return d.label + ' must be a positive amount.';
      if (d.type === 'photo' && value.media_id && !String(value.alt || '').trim()) return d.label + ': please add a short photo description (alt text).';
    }
    return null;
  }
  function trimAll(value) {
    Object.keys(value).forEach(function (k) { if (typeof value[k] === 'string') value[k] = value[k].trim(); });
    return value;
  }

  // ---------- list editor (offerings, FAQs, menu items, events…) ----------
  // opts: {collection, fields, title(v), defaults, filter(v), check(v) -> error, addLabel, note(row)}
  A.listEditor = function (box, opts) {
    box.textContent = '';
    var rows = C.list(opts.collection).filter(function (r) { return !opts.filter || opts.filter(r.draft || {}); });
    var ul = el('div', null, 'list-editor');
    rows.forEach(function (r, i) { ul.appendChild(item(r, i, rows)); });
    if (!rows.length) ul.appendChild(el('p', 'Nothing here yet.', 'muted'));
    box.appendChild(ul);
    var add = el('button', opts.addLabel || 'Add'); add.type = 'button';
    add.addEventListener('click', function () {
      var d = Object.assign({}, opts.defaults || {});
      C.add(opts.collection, d).then(function () { A.listEditor(box, opts); A.toast('Added — fill it in, then Save to put it on the website.'); })
        .catch(function (e) { A.toast(e.message, true); });
    });
    box.appendChild(add);

    function item(r, i, all) {
      var value = Object.assign({}, r.draft || {});
      var d = el('details', null, 'item');
      var sum = el('summary');
      sum.appendChild(el('span', opts.title(value) || '(untitled)', 'item-title'));
      sum.appendChild(A.draftBadge(r));
      if (opts.note) { var n = opts.note(value); if (n) sum.appendChild(el('span', n, 'badge')); }
      d.appendChild(sum);
      var grid = el('div', null, 'grid');
      var save = el('button', 'Save', 'primary'); save.type = 'button'; save.disabled = true;
      save.title = 'Saves and updates the live website.';
      opts.fields.forEach(function (f) { grid.appendChild(A.buildField(f, value, function () { save.disabled = false; })); });
      d.appendChild(grid);
      var acts = el('div', null, 'row-actions');
      save.addEventListener('click', function () {
        trimAll(value);
        var err = validate(opts.fields, value) || (opts.check && opts.check(value, r));
        if (err) { A.toast(err, true); return; }
        save.disabled = true; save.textContent = 'Saving…';
        A.saveLive([r], function () { return C.saveDraft(r, value); }).then(function (res) {
          save.textContent = 'Save';
          if (res && res.cancelled) { save.disabled = false; return; }
          A.toast('Saved — live on the website.'); A.listEditor(box, opts);
        }).catch(function (e) { save.textContent = 'Save'; save.disabled = false; A.toast('Saved, but not live yet: ' + e.message, true); A.listEditor(box, opts); });
      });
      var up = el('button', '↑'); up.type = 'button'; up.title = 'Move up'; up.disabled = i === 0;
      var dn = el('button', '↓'); dn.type = 'button'; dn.title = 'Move down'; dn.disabled = i === all.length - 1;
      function move(dir) {
        var other = all[i + dir], a = r.sort, b = other.sort;
        if (a === b) b = a + dir;
        Promise.all([A.db.from('cms_entries').update({ sort: b }).eq('id', r.id),
                     A.db.from('cms_entries').update({ sort: a }).eq('id', other.id)]).then(function (res) {
          if (res[0].error || res[1].error) { A.toast('Could not reorder.', true); return; }
          r.sort = b; other.sort = a; A.listEditor(box, opts);
          A.toast('Order updated on the website.');
        });
      }
      up.addEventListener('click', function () { move(-1); });
      dn.addEventListener('click', function () { move(1); });
      var rm = el('button', 'Remove', 'link'); rm.type = 'button';
      rm.addEventListener('click', function () {
        if (!confirm('Remove "' + (opts.title(value) || 'this item') + '" from the website now?\n\nYou can bring it back with Undo in History.')) return;
        A.saveLive([r], function () { return C.remove(r); }).then(function (res) {
          if (res && res.cancelled) return;
          A.listEditor(box, opts); A.toast('Removed from the website.');
        }).catch(function (e) { A.listEditor(box, opts); A.toast('Removed, but not live yet: ' + e.message, true); });
      });
      acts.appendChild(save); acts.appendChild(up); acts.appendChild(dn); acts.appendChild(rm);
      d.appendChild(acts);
      return d;
    }
  };

  // ---------- single named fields ----------
  function T(key, label, type, extra) { return Object.assign({ collection: 'text', key: key, k: 'value', label: label, type: type || 'text' }, extra); }
  function SHOW(key, label) { return { collection: 'toggle', key: key, k: 'visible', label: label, type: 'check' }; }
  function IMG(key, label, folder, builtIn) { return { collection: 'image', key: key, k: 'media_id', label: label, type: 'photo', folder: folder, builtIn: builtIn }; }
  function LINK(key, label) { return { collection: 'link', key: key, label: label, type: 'link' }; }
  function LIST(collection, label, fields, title, defaults) { return { list: true, collection: collection, label: label, fields: fields, title: title, defaults: defaults }; }
  var titleText = [{ k: 'title', label: 'Title', required: true }, { k: 'text', label: 'Text', type: 'textarea', rows: 2 }];

  var GROUPS = [
    { name: 'Announcement bar (all pages)', items: [
      SHOW('show.site.announcement', 'Show the announcement bar'),
      T('site.announcement.text', 'Announcement text', 'text', { max: 160 }),
      LINK('site.announcement.link', 'Announcement button'),
      LINK('site.header.cta', 'Header button (all pages)')] },
    { name: 'Homepage — hero', items: [
      IMG('home.hero.image', 'Hero photo', 'homepage'),
      T('home.hero.line1', 'Headline line 1'), T('home.hero.line2', 'Headline line 2'), T('home.hero.line3', 'Headline line 3'),
      T('home.hero.lede', 'Hero description', 'textarea'),
      LINK('home.hero.cta_primary', 'Main button'), LINK('home.hero.cta_secondary', 'Second button')] },
    { name: 'Homepage — the idea behind RAAHA', items: [
      SHOW('show.home.idea', 'Show this section'),
      T('home.idea.title', 'Heading'), T('home.idea.lead', 'Lead sentence'),
      T('home.idea.body', 'Paragraphs (blank line between paragraphs)', 'textarea', { rows: 8 })] },
    { name: 'Homepage — what you’ll find', items: [
      SHOW('show.home.find', 'Show this section'), T('home.find.title', 'Heading'), T('home.find.intro', 'Intro'),
      IMG('home.find.image', 'Background photo (shown under a burgundy overlay)', 'homepage', '/assets/images/web/raaha-matcha-chai-band.webp'),
      LIST('offering', 'Offerings', titleText, function (v) { return v.title; })] },
    { name: 'Homepage — featured drinks', items: [
      SHOW('show.home.drinks', 'Show this section'), T('home.drinks.title', 'Heading'),
      LIST('feature_card', 'Featured cards', titleText.concat([{ k: 'media_id', type: 'photo', label: 'Photo', folder: 'menu' }, { k: 'visible', type: 'check', label: 'Show on website' }]),
        function (v) { return v.title; }, { title: '', text: '', visible: true })] },
    { name: 'Homepage — the space', items: [
      SHOW('show.home.space', 'Show this section'), IMG('home.space.image', 'Photo', 'homepage'),
      T('home.space.title', 'Heading'), T('home.space.body', 'Paragraphs', 'textarea', { rows: 6 }),
      LIST('space_highlight', 'Highlights', [{ k: 'text', label: 'Highlight', required: true }], function (v) { return v.text; })] },
    { name: 'Homepage — Coffee Cart', items: [
      SHOW('show.home.cart', 'Show this section'), IMG('home.cart.image', 'Photo', 'coffee-cart'),
      IMG('home.cart.inset', 'Small overlapping photo', 'coffee-cart', '/assets/images/web/raaha-chai.webp'),
      T('home.cart.title', 'Heading'), T('home.cart.body', 'Description', 'textarea'),
      LIST('cart_fact', 'Key facts', [{ k: 'text', label: 'Fact', required: true }], function (v) { return v.text; }),
      LINK('home.cart.cta', 'Button')] },
    { name: 'Homepage — community', items: [
      SHOW('show.home.community', 'Show this section'), IMG('home.community.image', 'Photo', 'homepage'),
      T('home.community.quote', 'Quote'), T('home.community.title', 'Heading'), T('home.community.body', 'Paragraphs', 'textarea', { rows: 6 })] },
    { name: 'Homepage — photo gallery', help: 'Appears only once at least one photo is published here.', items: [
      SHOW('show.home.gallery', 'Show this section'), T('home.gallery.title', 'Heading'),
      LIST('gallery', 'Gallery photos', [{ k: 'media_id', type: 'photo', label: 'Photo', folder: 'gallery' }, { k: 'caption', label: 'Caption (optional)', max: 160 }, { k: 'visible', type: 'check', label: 'Show on website' }],
        function (v) { return v.caption || 'Photo'; }, { caption: '', visible: true })] },
    { name: 'Homepage — events & experiences', help: 'Dated events are managed in the Events tab; they appear here first, followed by these experience types.', items: [
      SHOW('show.home.events', 'Show this section'), T('home.events.title', 'Heading'), T('home.events.intro', 'Intro', 'textarea'),
      LIST('experience', 'Experience types', titleText.concat([{ k: 'visible', type: 'check', label: 'Show on website' }]), function (v) { return v.title; }, { title: '', text: '', visible: true })] },
    { name: 'Homepage — team & newsletter', items: [
      T('home.team.title', 'Team heading'), T('home.team.body', 'Team text', 'textarea'),
      T('home.newsletter.title', 'Newsletter heading'), T('home.newsletter.body', 'Newsletter text', 'textarea')] },
    { name: 'About page', help: 'Photos on the About page. The text on this page is fixed for now.', items: [
      IMG('about.hero.image', 'Header photo', 'general', '/assets/images/web/raaha-community-table.webp'),
      IMG('about.space.image', '“A Space for People” photo', 'general', '/assets/images/web/raaha-interior.webp'),
      IMG('about.experience.image', '“A Modern Community Café” photo', 'general', '/assets/images/web/raaha-chai.webp')] },
    { name: 'Menu, Events & Contact — header photos', items: [
      IMG('menu.hero.image', 'Menu header photo (under a burgundy overlay)', 'menu', '/assets/images/web/menu-head-chai.webp'),
      IMG('events.hero.image', 'Events header photo (under a soft dark overlay)', 'events', '/assets/images/web/events-head-gathering.webp'),
      IMG('contact.hero.image', 'Contact header photo (dark text sits directly on the photo; choose a light, calm photo)', 'general', '/assets/images/web/raaha-interior.webp')] },
    { name: 'Coffee Cart page', items: [
      IMG('cart.hero.image', 'Header photo', 'coffee-cart', '/assets/images/web/coffee-cart-gathering.webp'),
      IMG('cart.intro.image', 'Introduction photo (gold arch)', 'coffee-cart', '/assets/images/web/raaha-coffee.webp'),
      T('cart.hero.title', 'Page heading'), T('cart.hero.lede', 'Intro', 'textarea'),
      T('cart.intro.title', 'Section heading'), T('cart.intro.body', 'Paragraphs', 'textarea', { rows: 6 }),
      T('cart.menu.intro', 'Menu intro', 'textarea'),
      T('cart.area.intro', 'Service area intro', 'textarea'),
      LIST('service_area', 'Service areas', [{ k: 'name', label: 'Area', required: true }], function (v) { return v.name; }),
      T('cart.area.note', 'Service area note', 'textarea'),
      LIST('faq', 'FAQs', [{ k: 'question', label: 'Question', required: true, wide: true }, { k: 'answer', label: 'Answer', type: 'textarea', required: true }], function (v) { return v.question; })] }
  ];

  // Readable "where is this used" names for the photo library
  var PLACES = {};
  GROUPS.forEach(function (g) {
    g.items.forEach(function (it) {
      if (it.list) PLACES['list:' + it.collection] = g.name + ' → ' + it.label;
      else PLACES[it.collection + ':' + it.key] = g.name + ' → ' + it.label;
    });
  });
  C.describe = function (r) {
    var v = r.draft || r.published_source || r.live_source || {};
    if (r.key) return PLACES[r.collection + ':' + r.key] || (r.collection + ' ' + r.key);
    if (r.collection === 'menu_category') return 'Menu → category ' + (v.name || '(new)');
    if (r.collection === 'menu_item') return 'Menu → ' + (v.name || '(new item)');
    if (r.collection === 'event') return 'Events tab → ' + (v.title || 'event');
    var base = PLACES['list:' + r.collection] || r.collection;
    var t = v.title || v.caption || v.question || v.name || v.text;
    return base + (t ? ' → ' + String(t).slice(0, 60) : '');
  };

  function render() {
    var box = $('content-groups'); box.textContent = '';
    GROUPS.forEach(function (g) {
      var sec = el('details', null, 'group');
      sec.appendChild(el('summary', g.name));
      if (g.help) sec.appendChild(el('p', g.help, 'muted'));
      var singles = g.items.filter(function (x) { return !x.list; });
      var pending = [];
      var grid = el('div', null, 'grid');
      var save = el('button', 'Save', 'primary'); save.type = 'button'; save.disabled = true;
      save.title = 'Saves and updates the live website.';
      singles.forEach(function (def) {
        var row = C.byKey(def.collection, def.key);
        var value = Object.assign({}, row && row.draft || {});
        if (!row && def.builtIn) value.static_src = def.builtIn; // show the photo built into the page
        var holder = el('div', null, def.type === 'textarea' || def.type === 'photo' || def.type === 'link' ? 'wide' : '');
        var head = el('div', null, 'field-head'); head.appendChild(A.draftBadge(row)); holder.appendChild(head);
        var dirty = function () { save.disabled = false; if (pending.indexOf(entry) === -1) pending.push(entry); };
        var entry = { def: def, value: value };
        if (def.type === 'link') {
          var lbl = A.input('text', value.label, { maxlength: 60 }), href = A.input('text', value.href, { maxlength: 300 });
          lbl.addEventListener('input', function () { value.label = lbl.value; dirty(); });
          href.addEventListener('input', function () { value.href = href.value; dirty(); });
          var lg = el('div', null, 'grid'); lg.appendChild(A.field(def.label + ' — text', lbl)); lg.appendChild(A.field('Goes to (e.g. /coffee-cart#book)', href));
          holder.appendChild(lg);
        } else {
          holder.appendChild(A.buildField(def, value, dirty));
        }
        grid.appendChild(holder);
      });
      sec.appendChild(grid);
      if (singles.length) {
        save.addEventListener('click', function () {
          for (var i = 0; i < pending.length; i++) {
            var p = pending[i]; trimAll(p.value);
            if (p.def.type === 'link') {
              if (!p.value.label) { A.toast(p.def.label + ': button text is required.', true); return; }
              if (!A.safeHref(p.value.href)) { A.toast(p.def.label + ': the link must start with /, #, https://, mailto: or tel:', true); return; }
            }
            if (p.def.collection === 'text' && !p.value.value) { A.toast(p.def.label + ' cannot be empty (hide the section instead).', true); return; }
            if (p.def.type === 'photo' && p.value.media_id && !String(p.value.alt || '').trim()) { A.toast(p.def.label + ': please add a short photo description.', true); return; }
          }
          var targets = pending.map(function (p) { return C.byKey(p.def.collection, p.def.key); });
          save.disabled = true; save.textContent = 'Saving…';
          A.saveLive(targets, function () {
            return Promise.all(pending.map(function (p) { return C.saveNamed(p.def.collection, p.def.key, p.value); }));
          }).then(function (res) {
            save.textContent = 'Save';
            if (res && res.cancelled) { save.disabled = false; return; }
            A.toast('Saved — live on the website.'); render(); reopen(g.name);
          }).catch(function (e) { save.textContent = 'Save'; save.disabled = false; A.toast('Saved, but not live yet: ' + e.message, true); render(); reopen(g.name); });
        });
        var acts = el('div', null, 'row-actions'); acts.appendChild(save); sec.appendChild(acts);
      }
      g.items.filter(function (x) { return x.list; }).forEach(function (l) {
        sec.appendChild(el('h3', l.label));
        var lb = el('div'); sec.appendChild(lb);
        A.listEditor(lb, { collection: l.collection, fields: l.fields, title: l.title, defaults: l.defaults, addLabel: 'Add to ' + l.label.toLowerCase() });
      });
      box.appendChild(sec);
    });
  }
  function reopen(name) {
    Array.prototype.forEach.call(document.querySelectorAll('#content-groups > details'), function (d) {
      if (d.querySelector('summary').textContent === name) d.open = true;
    });
  }

  A.modules.push({ tab: 'content', onShow: function () {
    var open = Array.prototype.filter.call(document.querySelectorAll('#content-groups > details[open]'), function () { return true; })
      .map(function (d) { return d.querySelector('summary').textContent; });
    render(); open.forEach(reopen);
  } });
})();
