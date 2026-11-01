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
      input = A.input('checkbox'); input.checked = def.isOn ? def.isOn(value) : v !== false;
      input.addEventListener('change', function () { value[def.k] = input.checked; onDirty(); });
      wrap = el('label', null, 'check inline'); wrap.appendChild(input); wrap.appendChild(document.createTextNode(' ' + def.label));
      return wrap;
    }
    if (def.type === 'cartsection') {
      // headings already used on the Coffee Cart menu, plus "New heading…"
      input = el('select');
      var names = A.cartSections(), cur = v || '';
      if (cur && names.indexOf(cur) === -1) names.push(cur);
      [['', '— choose a heading —']].concat(names.map(function (n) { return [n, n]; })).concat([['__new', 'New heading…']])
        .forEach(function (o) { var op = el('option', o[1]); op.value = o[0]; input.appendChild(op); });
      input.value = cur;
      input.addEventListener('change', function () {
        if (input.value === '__new') {
          var name = (prompt('Name of the new Coffee Cart menu heading (for example “Seasonal Drinks”):') || '').trim().slice(0, 60);
          if (!name) { input.value = value[def.k] || ''; return; }
          var op = el('option', name); op.value = name; input.insertBefore(op, input.lastChild); input.value = name;
        }
        value[def.k] = input.value; onDirty();
      });
      wrap = A.field(def.label, input);
      if (def.help) wrap.appendChild(el('span', def.help, 'muted small'));
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
    if (!rows.length && opts.seed && opts.seed.length) return seedView(box, opts);
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
      if (opts.quick) sum.appendChild(quickSwitches(r, value));
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

    // One-click switches (e.g. Show / Available / On Coffee Cart): each click saves and goes live
    function quickSwitches(r, value) {
      var wrapQ = el('span', null, 'quick');
      opts.quick.forEach(function (q) {
        var on = q.isOn(value);
        var b = el('button', q.label, 'switch' + (on ? ' is-on' : '')); b.type = 'button';
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
        b.title = (on ? 'On' : 'Off') + ' — click to turn ' + (on ? 'off' : 'on') + ' (updates the live website)';
        b.addEventListener('click', function (e) {
          e.preventDefault(); e.stopPropagation();
          var nv = Object.assign({}, r.draft || {});
          q.apply(nv, !on);
          b.disabled = true;
          A.saveLive([r], function () { return C.saveDraft(r, nv); }).then(function (res) {
            if (res && res.cancelled) { b.disabled = false; return; }
            A.toast(q.label + (on ? ' off' : ' on') + ' — live on the website.'); A.listEditor(box, opts);
            if (opts.onChange) opts.onChange();
          }).catch(function (e2) { b.disabled = false; A.toast('Not live: ' + e2.message, true); A.listEditor(box, opts); });
        });
        wrapQ.appendChild(b);
      });
      return wrapQ;
    }
  };

  // A list that has never been edited still shows the items built into the page.
  // "Start editing" copies those exact items here and publishes them unchanged, so the page looks the same.
  function seedView(box, opts) {
    var wrapS = el('div', null, 'seed');
    wrapS.appendChild(el('p', 'Shown on the website now (built into the page):', 'muted small'));
    var ul = el('ul', null, 'seed-list');
    opts.seed.forEach(function (v) { ul.appendChild(el('li', opts.title(v) || '(untitled)')); });
    wrapS.appendChild(ul);
    var go = el('button', 'Start editing this list'); go.type = 'button';
    go.addEventListener('click', function () {
      go.disabled = true; go.textContent = 'Preparing…';
      var made = [];
      opts.seed.reduce(function (p, v) {
        return p.then(function () { return C.add(opts.collection, Object.assign({}, opts.defaults || {}, v)).then(function (row) { made.push(row); }); });
      }, Promise.resolve()).then(function () {
        return A.saveLive(made, null);
      }).then(function (res) {
        if (res && res.cancelled) { A.toast('Not started.', true); }
        else A.toast('Ready — the items are now editable here. The website is unchanged.');
        A.listEditor(box, opts);
      }).catch(function (e) { A.toast('Could not start: ' + e.message, true); A.listEditor(box, opts); });
    });
    wrapS.appendChild(go);
    box.appendChild(wrapS);
  }

  // ---------- single named fields ----------
  function T(key, label, type, extra) { return Object.assign({ collection: 'text', key: key, k: 'value', label: label, type: type || 'text' }, extra); }
  function SHOW(key, label) { return { collection: 'toggle', key: key, k: 'visible', label: label, type: 'check' }; }
  function IMG(key, label, folder, builtIn) { return { collection: 'image', key: key, k: 'media_id', label: label, type: 'photo', folder: folder, builtIn: builtIn }; }
  function LINK(key, label) { return { collection: 'link', key: key, label: label, type: 'link' }; }
  function LIST(collection, label, fields, title, defaults) { return { list: true, collection: collection, label: label, fields: fields, title: title, defaults: defaults }; }
  var titleText = [{ k: 'title', label: 'Title', required: true }, { k: 'text', label: 'Text', type: 'textarea', rows: 2 }];

  var GROUPS = [
    { page: 'site', name: 'Announcement bar (all pages)', items: [
      SHOW('show.site.announcement', 'Show the announcement bar'),
      T('site.announcement.text', 'Announcement text', 'text', { max: 160 }),
      LINK('site.announcement.link', 'Announcement button'),
      LINK('site.header.cta', 'Header button (all pages)')] },
    { page: 'home', name: 'Homepage — hero', items: [
      IMG('home.hero.image', 'Hero photo', 'homepage'),
      T('home.hero.line1', 'Headline line 1'), T('home.hero.line2', 'Headline line 2'), T('home.hero.line3', 'Headline line 3'),
      T('home.hero.lede', 'Hero description', 'textarea'),
      LINK('home.hero.cta_primary', 'Main button'), LINK('home.hero.cta_secondary', 'Second button')] },
    { page: 'home', name: 'Homepage — the idea behind RAAHA', items: [
      SHOW('show.home.idea', 'Show this section'),
      T('home.idea.title', 'Heading'), T('home.idea.lead', 'Lead sentence'),
      T('home.idea.body', 'Paragraphs (blank line between paragraphs)', 'textarea', { rows: 8 })] },
    { page: 'home', name: 'Homepage — what you’ll find', items: [
      SHOW('show.home.find', 'Show this section'), T('home.find.title', 'Heading'), T('home.find.intro', 'Intro'),
      IMG('home.find.image', 'Background photo (shown under a burgundy overlay)', 'homepage', '/assets/images/web/raaha-matcha-chai-band.webp'),
      LIST('offering', 'Offerings', titleText, function (v) { return v.title; })] },
    { page: 'home', name: 'Homepage — featured drinks', items: [
      SHOW('show.home.drinks', 'Show this section'), T('home.drinks.title', 'Heading'),
      LIST('feature_card', 'Featured cards', titleText.concat([{ k: 'media_id', type: 'photo', label: 'Photo', folder: 'menu' }, { k: 'visible', type: 'check', label: 'Show on website' }]),
        function (v) { return v.title; }, { title: '', text: '', visible: true })] },
    { page: 'home', name: 'Homepage — the space', items: [
      SHOW('show.home.space', 'Show this section'), IMG('home.space.image', 'Photo', 'homepage'),
      T('home.space.title', 'Heading'), T('home.space.body', 'Paragraphs', 'textarea', { rows: 6 }),
      LIST('space_highlight', 'Highlights', [{ k: 'text', label: 'Highlight', required: true }], function (v) { return v.text; })] },
    { page: 'home', name: 'Homepage — Coffee Cart', items: [
      SHOW('show.home.cart', 'Show this section'), IMG('home.cart.image', 'Photo', 'coffee-cart'),
      IMG('home.cart.inset', 'Small overlapping photo', 'coffee-cart', '/assets/images/web/raaha-chai.webp'),
      T('home.cart.title', 'Heading'), T('home.cart.body', 'Description', 'textarea'),
      LIST('cart_fact', 'Key facts', [{ k: 'text', label: 'Fact', required: true }], function (v) { return v.text; }),
      LINK('home.cart.cta', 'Button')] },
    { page: 'home', name: 'Homepage — community', items: [
      SHOW('show.home.community', 'Show this section'), IMG('home.community.image', 'Photo', 'homepage'),
      T('home.community.quote', 'Quote'), T('home.community.title', 'Heading'), T('home.community.body', 'Paragraphs', 'textarea', { rows: 6 })] },
    { page: 'home', name: 'Homepage — photo gallery', help: 'Appears only once at least one photo is published here.', items: [
      SHOW('show.home.gallery', 'Show this section'), T('home.gallery.title', 'Heading'),
      LIST('gallery', 'Gallery photos', [{ k: 'media_id', type: 'photo', label: 'Photo', folder: 'gallery' }, { k: 'caption', label: 'Caption (optional)', max: 160 }, { k: 'visible', type: 'check', label: 'Show on website' }],
        function (v) { return v.caption || 'Photo'; }, { caption: '', visible: true })] },
    { page: 'home', name: 'Homepage — events & experiences', help: 'Dated events are managed in the Events tab; they appear here first, followed by these experience types.', items: [
      SHOW('show.home.events', 'Show this section'), T('home.events.title', 'Heading'), T('home.events.intro', 'Intro', 'textarea'),
      LIST('experience', 'Experience types', titleText.concat([{ k: 'visible', type: 'check', label: 'Show on website' }]), function (v) { return v.title; }, { title: '', text: '', visible: true })] },
    { page: 'home', name: 'Homepage — team & newsletter', items: [
      T('home.team.title', 'Team heading'), T('home.team.body', 'Team text', 'textarea'),
      T('home.newsletter.title', 'Newsletter heading'), T('home.newsletter.body', 'Newsletter text', 'textarea')] },
    { page: 'about', name: 'About — header', items: [
      IMG('about.hero.image', 'Header photo', 'general', '/assets/images/web/raaha-community-table.webp'),
      T('about.hero.eyebrow', 'Small heading'), T('about.hero.title', 'Page heading')] },
    { page: 'about', name: 'About — introduction', items: [
      T('about.intro.body', 'Paragraphs (blank line between paragraphs)', 'textarea', { rows: 7 })] },
    { page: 'about', name: 'About — “A Space for People”', items: [
      IMG('about.space.image', 'Photo', 'general', '/assets/images/web/raaha-interior.webp'),
      T('about.space.title', 'Heading'), T('about.space.body', 'Paragraphs (blank line between paragraphs)', 'textarea', { rows: 8 }),
      T('about.space.quote', 'Quote')] },
    { page: 'about', name: 'About — mission', items: [
      T('about.mission.eyebrow', 'Small heading'), T('about.mission.title', 'Heading'),
      T('about.mission.body', 'Paragraphs (blank line between paragraphs)', 'textarea', { rows: 6 }),
      LIST('about_pillar', 'Pause · Connect · Belong', titleText, function (v) { return v.title; })] },
    { page: 'about', name: 'About — the experience', items: [
      IMG('about.experience.image', 'Photo', 'general', '/assets/images/web/raaha-chai.webp'),
      T('about.experience.eyebrow', 'Small heading'), T('about.experience.title', 'Heading'),
      T('about.experience.body', 'Paragraphs (blank line between paragraphs)', 'textarea', { rows: 8 })] },
    { page: 'about', name: 'About — values', items: [
      T('about.values.title', 'Heading'),
      LIST('about_value', 'Values', titleText, function (v) { return v.title; })] },
    { page: 'about', name: 'About — Coffee Cart band', items: [
      T('about.cta.title', 'Heading'), T('about.cta.body', 'Text', 'textarea', { rows: 2 }), LINK('about.cta.button', 'Button')] },
    { page: 'menu', name: 'Menu page — header', help: 'Items, prices and category photos are under Website → Menu.', items: [
      IMG('menu.hero.image', 'Header photo (under a burgundy overlay)', 'menu', '/assets/images/web/menu-head-chai.webp'),
      T('menu.hero.eyebrow', 'Small heading'), T('menu.hero.title', 'Page heading'), T('menu.hero.intro', 'Introduction', 'textarea', { rows: 3 })] },
    { page: 'menu', name: 'Menu page — Coffee Cart band', items: [
      T('menu.cta.title', 'Heading'), T('menu.cta.body', 'Text', 'textarea', { rows: 2 }), LINK('menu.cta.button', 'Button')] },
    { page: 'events', name: 'Events — header', help: 'The events themselves are under Website → Events.', items: [
      IMG('events.hero.image', 'Header photo (under a soft dark overlay)', 'events', '/assets/images/web/events-head-gathering.webp'),
      T('events.hero.eyebrow', 'Small heading'), T('events.hero.title', 'Page heading'), T('events.hero.intro', 'Introduction', 'textarea', { rows: 3 })] },
    { page: 'events', name: 'Events — upcoming', items: [
      T('events.upcoming.eyebrow', 'Small heading'), T('events.upcoming.title', 'Heading')] },
    { page: 'events', name: 'Events — host a gathering', help: 'The form and the line linking to the Coffee Cart are fixed.', items: [
      T('events.host.eyebrow', 'Small heading'), T('events.host.title', 'Heading'),
      T('events.host.body', 'Paragraphs (blank line between paragraphs)', 'textarea', { rows: 4 })] },
    { page: 'careers', name: 'Careers — header', items: [
      T('careers.hero.eyebrow', 'Small heading'), T('careers.hero.title', 'Page heading'), T('careers.hero.intro', 'Introduction', 'textarea', { rows: 4 })] },
    { page: 'careers', name: 'Careers — culture', items: [
      T('careers.culture.eyebrow', 'Small heading'), T('careers.culture.title', 'Heading'),
      T('careers.culture.body', 'Paragraphs (blank line between paragraphs)', 'textarea', { rows: 4 }),
      LIST('career_value', 'What we value', titleText, function (v) { return v.title; })] },
    { page: 'careers', name: 'Careers — openings', help: 'The application form’s “Position of interest” list follows these roles.', items: [
      T('careers.openings.eyebrow', 'Small heading'), T('careers.openings.title', 'Heading'),
      LIST('career_role', 'Roles', [{ k: 'title', label: 'Role', required: true, max: 80 }, { k: 'type', label: 'Type (e.g. Part-time)', max: 60 },
        { k: 'text', label: 'Description', type: 'textarea', rows: 3 }, { k: 'visible', label: 'Show on website', type: 'check' }],
        function (v) { return (v.title || '') + (v.type ? ' · ' + v.type : '') + (v.visible === false ? ' · hidden' : ''); }, { visible: true })] },
    { page: 'careers', name: 'Careers — apply', help: 'The application form itself is fixed.', items: [
      T('careers.apply.eyebrow', 'Small heading'), T('careers.apply.title', 'Heading'),
      T('careers.apply.body', 'Paragraphs (blank line between paragraphs)', 'textarea', { rows: 3 })] },
    { page: 'contact', name: 'Contact — header', items: [
      IMG('contact.hero.image', 'Header photo (dark text sits directly on the photo; choose a light, calm photo)', 'general', '/assets/images/web/raaha-interior.webp'),
      T('contact.hero.eyebrow', 'Small heading'), T('contact.hero.title', 'Page heading'), T('contact.hero.intro', 'Introduction', 'textarea', { rows: 3 })] },
    { page: 'contact', name: 'Contact — details and form', help: 'Email, phone, social links and the form are fixed in the page.', items: [
      T('contact.info.title', 'Contact details heading'), T('contact.follow.note', 'Note under the details', 'textarea', { rows: 2 }),
      T('contact.form.title', 'Form heading')] },
    { page: 'cart', name: 'Coffee Cart page', items: [
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

  // ---------- pages: choose a page, edit its text, photos and lists together ----------
  var PAGES = [
    { id: 'home', label: 'Home', file: '/' },
    { id: 'about', label: 'About', file: '/about' },
    { id: 'menu', label: 'Menu', file: '/menu' },
    { id: 'cart', label: 'Coffee Cart', file: '/coffee-cart' },
    { id: 'events', label: 'Events', file: '/events' },
    { id: 'careers', label: 'Careers', file: '/careers' },
    { id: 'contact', label: 'Contact', file: '/contact' },
    { id: 'site', label: 'All pages (banner & header button)', file: '/' }
  ];
  var currentPage = 'home';
  try { currentPage = sessionStorage.getItem('raaha-admin-page') || 'home'; } catch (e) {}

  // What a page shows when nothing has been saved here yet: read from the page itself,
  // so fields start with the wording visitors see (never blank).
  var builtInCache = {};
  function clean(t) { return String(t || '').replace(/\s+/g, ' ').trim(); }
  function extract(html) {
    var out = { text: {}, link: {}, lists: {} };
    if (!html) return out;
    var doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('[data-cms]').forEach(function (e) { out.text[e.getAttribute('data-cms')] = clean(e.textContent); });
    doc.querySelectorAll('[data-cms-paras]').forEach(function (e) {
      out.text[e.getAttribute('data-cms-paras')] = Array.prototype.map.call(e.querySelectorAll('p'), function (p) { return clean(p.textContent); }).join('\n\n');
    });
    doc.querySelectorAll('[data-cms-link]').forEach(function (a) { out.link[a.getAttribute('data-cms-link')] = { label: clean(a.textContent), href: a.getAttribute('href') }; });
    doc.querySelectorAll('[data-cms-list]').forEach(function (box) {
      var items = [];
      Array.prototype.forEach.call(box.children, function (c) {
        if (c.tagName === 'TEMPLATE') return;
        var v = {};
        c.querySelectorAll('[data-f]').forEach(function (f) { v[f.getAttribute('data-f')] = clean(f.textContent); });
        if (Object.keys(v).length) items.push(v);
      });
      out.lists[box.getAttribute('data-cms-list')] = items;
    });
    return out;
  }
  function builtIns(pageId) {
    var pg = PAGES.filter(function (p) { return p.id === pageId; })[0] || PAGES[0];
    if (!builtInCache[pg.file]) {
      var alt = pg.file === '/' ? '/index.html' : pg.file + '.html';
      builtInCache[pg.file] = fetch(pg.file, { cache: 'no-store' })
        .then(function (r) { return r.ok ? r : fetch(alt, { cache: 'no-store' }); })
        .then(function (r) { return r.ok ? r.text() : ''; })
        .then(extract)
        .catch(function () { return extract(''); });
    }
    return builtInCache[pg.file];
  }

  function renderPicker() {
    var box = $('page-picker'); box.textContent = '';
    PAGES.forEach(function (pg) {
      var b = el('button', pg.label, pg.id === currentPage ? 'is-active' : ''); b.type = 'button';
      b.setAttribute('aria-pressed', pg.id === currentPage ? 'true' : 'false');
      b.addEventListener('click', function () { showPage(pg.id); });
      box.appendChild(b);
    });
  }
  function showPage(id, reopenNames) {
    currentPage = PAGES.some(function (p) { return p.id === id; }) ? id : 'home';
    try { sessionStorage.setItem('raaha-admin-page', currentPage); } catch (e) {}
    renderPicker();
    var box = $('content-groups');
    if (!box.children.length || box.dataset.page !== currentPage) { box.textContent = ''; box.appendChild(el('p', 'Loading the page…', 'muted')); }
    builtIns(currentPage).then(function (defaults) {
      render(defaults);
      if (reopenNames && reopenNames.length) reopenNames.forEach(reopen);
      else { var first = box.querySelector('details.group'); if (first) first.open = true; }
    });
  }
  A.showContentPage = showPage;

  function render(defaults) {
    var box = $('content-groups'); box.textContent = ''; box.dataset.page = currentPage;
    GROUPS.filter(function (g) { return g.page === currentPage; }).forEach(function (g) {
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
        if (!row) {
          if (def.builtIn) value.static_src = def.builtIn; // show the photo built into the page
          if (def.collection === 'text' && defaults.text[def.key] != null) value.value = defaults.text[def.key];
          if (def.collection === 'link' && defaults.link[def.key]) { value.label = defaults.link[def.key].label; value.href = defaults.link[def.key].href; }
        }
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
            A.toast('Saved — live on the website.'); showPage(currentPage, [g.name]);
          }).catch(function (e) { save.textContent = 'Save'; save.disabled = false; A.toast('Saved, but not live yet: ' + e.message, true); showPage(currentPage, [g.name]); });
        });
        var acts = el('div', null, 'row-actions'); acts.appendChild(save); sec.appendChild(acts);
      }
      g.items.filter(function (x) { return x.list; }).forEach(function (l) {
        sec.appendChild(el('h3', l.label));
        var lb = el('div'); sec.appendChild(lb);
        A.listEditor(lb, { collection: l.collection, fields: l.fields, title: l.title, defaults: l.defaults,
          addLabel: 'Add to ' + l.label.toLowerCase(), seed: defaults.lists[l.collection] });
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
    showPage(currentPage, open);
  } });
})();
