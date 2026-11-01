/*
 * RAAHA website content loader.
 * Pages ship with the approved content built in. This script swaps in the PUBLISHED content
 * from the RAAHA admin. With ?preview=draft (and the admin signed in on this browser) it shows
 * unpublished DRAFTS instead. If anything fails, the built-in content simply stays.
 * All values are inserted as plain text — never as HTML.
 */
(function () {
  'use strict';
  var cfg = window.RAAHA_CONFIG;
  // Page photos stay invisible (class set in <head>) until the published content has been applied,
  // so visitors never see the built-in photo flash before the published one. Safety timeout in <head>.
  function reveal() { document.documentElement.classList.remove('cms-wait'); }
  if (!cfg || !window.fetch) { reveal(); return; }

  var MEDIA_BASE = cfg.supabaseUrl + '/storage/v1/object/public/site-media/';
  var params = new URLSearchParams(location.search);
  var wantDraft = params.get('preview') === 'draft';
  var token = null;
  if (wantDraft) {
    try {
      var session = JSON.parse(localStorage.getItem('raaha-admin-auth'));
      if (session && session.access_token && session.expires_at * 1000 > Date.now()) token = session.access_token;
    } catch (e) { /* no session */ }
  }

  // Signed-in admin browsing the site: small shortcut back to the admin (visitors never see it)
  if (!wantDraft) {
    try {
      var s0 = JSON.parse(localStorage.getItem('raaha-admin-auth'));
      if (s0 && s0.access_token && s0.expires_at * 1000 > Date.now()) {
        document.addEventListener('DOMContentLoaded', function () {
          var a = document.createElement('a'); a.href = '/admin/'; a.textContent = 'RAAHA admin';
          a.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:3000;background:#2E2A27;color:#F4EDE4;border-radius:999px;padding:6px 14px;font:13px/1.4 -apple-system,Segoe UI,Arial,sans-serif;text-decoration:none;box-shadow:0 4px 16px rgba(0,0,0,.2)';
          document.body.appendChild(a);
        });
      }
    } catch (e) { /* not signed in */ }
  }

  var headers = { apikey: cfg.supabasePublishableKey };
  if (token) headers.Authorization = 'Bearer ' + token;
  var base = cfg.supabaseUrl + '/rest/v1/';
  // The live domain reads the PRODUCTION copy; every other address (previews) reads the PREVIEW copy.
  var isProduction = (cfg.productionHosts || []).indexOf(location.hostname) !== -1;
  var column = isProduction ? 'live' : 'published';
  var query = token
    ? 'select=id,collection,key,sort,draft,draft_deleted&draft=not.is.null'
    : 'select=id,collection,key,sort,' + column + '&' + column + '=not.is.null';

  function getJson(url) {
    return fetch(url, { headers: headers }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  function imageUrl(v) {
    if (!v) return null;
    if (v.signed) return v.signed;            // draft preview: private photo, temporary link
    if (v.src) return MEDIA_BASE + v.src;
    return v.static_src || null;
  }

  // Photo framing chosen in Admin (display only; the uploaded photo itself is never cropped).
  // fx/fy = desktop focus point (%), fz = desktop zoom; mx/my/mz = phone. Returns true when zoomed.
  function clampNum(n, lo, hi, d) { n = Number(n); return (n === n && isFinite(n)) ? Math.min(hi, Math.max(lo, n)) : d; }
  function hasPos(v) { return !!v && ['fx', 'fy', 'fz', 'mx', 'my', 'mz'].some(function (k) { return v[k] != null && v[k] !== ''; }); }
  function applyPos(img, v) {
    if (!hasPos(v)) { img.classList.remove('cms-pos'); return false; }
    var fx = clampNum(v.fx, 0, 100, 50), fy = clampNum(v.fy, 0, 100, 50), fz = clampNum(v.fz, 1, 3, 1);
    var mx = clampNum(v.mx, 0, 100, fx), my = clampNum(v.my, 0, 100, fy), mz = clampNum(v.mz, 1, 3, fz);
    img.style.setProperty('--px', fx + '%'); img.style.setProperty('--py', fy + '%'); img.style.setProperty('--pz', String(fz));
    img.style.setProperty('--mpx', mx + '%'); img.style.setProperty('--mpy', my + '%'); img.style.setProperty('--mpz', String(mz));
    img.classList.add('cms-pos');
    return fz > 1 || mz > 1;
  }

  // ---------- load ----------
  // Published content: the small script in each page's <head> starts this request early (no draft
  // preview); reuse it so photos can be shown sooner. Otherwise fetch it here.
  var load = (!token && window.__raahaCms) ? window.__raahaCms : getJson(base + 'cms_entries?' + query + '&order=sort.asc,id.asc');
  var loadMedia = token ? getJson(base + 'media?select=id,path,thumb_path,alt_text,width,height').then(signMedia) : Promise.resolve([]);

  // Drafts may use photos that are not public yet: ask for short-lived private links (admin only)
  function signMedia(list) {
    if (!list.length) return list;
    return fetch(cfg.supabaseUrl + '/storage/v1/object/sign/media-private', {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, headers),
      body: JSON.stringify({ expiresIn: 3600, paths: list.map(function (m) { return m.path; }) })
    }).then(function (r) { return r.ok ? r.json() : []; }).then(function (signed) {
      var byPath = {};
      (signed || []).forEach(function (x) { if (x.signedURL) byPath[x.path] = cfg.supabaseUrl + '/storage/v1' + x.signedURL; });
      list.forEach(function (m) { m.signed = byPath[m.path] || null; });
      return list;
    }).catch(function () { return list; });
  }

  Promise.all([load, loadMedia]).then(function (res) {
    var rows = res[0], media = {};
    res[1].forEach(function (m) { media[m.id] = m; });
    if (!rows.length) { reveal(); return; } // nothing published yet: keep built-in content
    var single = {}, lists = {};
    rows.forEach(function (r) {
      var v;
      if (token) {
        if (r.draft_deleted || !r.draft) return;
        v = Object.assign({}, r.draft);
        var m = v.media_id && media[v.media_id];
        if (m) { v.signed = m.signed; v.alt = v.alt || m.alt_text || ''; v.w = m.width; v.h = m.height; }
      } else {
        v = r[column];
      }
      if (!v) return;
      if (r.key) single[r.collection + ':' + r.key] = v;
      else (lists[r.collection] = lists[r.collection] || []).push(v);
    });
    apply(single, lists);
    reveal();
    if (wantDraft) previewBar(token ? 'Previewing unpublished drafts. Visitors still see the published version.' : null);
  }).catch(function () {
    reveal();
    if (wantDraft) previewBar(null);
  });

  // ---------- apply ----------
  function apply(single, lists) {
    document.querySelectorAll('[data-cms]').forEach(function (el) {
      var v = single['text:' + el.getAttribute('data-cms')];
      if (v && typeof v.value === 'string' && v.value.trim()) el.textContent = v.value;
    });
    document.querySelectorAll('[data-cms-paras]').forEach(function (el) {
      var v = single['text:' + el.getAttribute('data-cms-paras')];
      if (!v || typeof v.value !== 'string' || !v.value.trim()) return;
      el.textContent = '';
      v.value.split(/\n\s*\n/).forEach(function (para) {
        var p = document.createElement('p'); p.textContent = para.trim(); el.appendChild(p);
      });
    });
    document.querySelectorAll('[data-cms-img]').forEach(function (img) {
      var v = single['image:' + img.getAttribute('data-cms-img')];
      var url = imageUrl(v);
      if (!url) return;
      applyPos(img, v);
      img.removeAttribute('srcset');
      if (img.getAttribute('src') !== url) {
        // a different photo: keep this spot hidden until the new photo has loaded, then fade it in
        img.classList.add('cms-swap');
        var shown = function () { img.classList.remove('cms-swap'); };
        img.addEventListener('load', shown, { once: true });
        img.addEventListener('error', shown, { once: true });
        img.src = url;
      }
      if (v.alt) img.alt = v.alt;
      if (v.w && v.h) { img.width = v.w; img.height = v.h; }
    });
    try { localStorage.removeItem('raaha-cms-photos'); } catch (e) { /* tidy up an earlier version */ }
    document.querySelectorAll('[data-cms-link]').forEach(function (a) {
      var v = single['link:' + a.getAttribute('data-cms-link')];
      if (!v) return;
      if (typeof v.label === 'string' && v.label.trim()) a.textContent = v.label;
      if (typeof v.href === 'string' && /^(\/|#|https:\/\/|mailto:|tel:)/.test(v.href)) a.setAttribute('href', v.href);
    });
    document.querySelectorAll('[data-cms-show]').forEach(function (el) {
      var v = single['toggle:' + el.getAttribute('data-cms-show')];
      if (v && v.visible === false) el.hidden = true;
    });
    document.querySelectorAll('[data-cms-list]').forEach(function (box) {
      var col = box.getAttribute('data-cms-list');
      // a list never saved in Admin keeps the items built into the page
      if (!lists[col] && col !== 'event') return;
      var items = (lists[col] || []).filter(function (v) { return v.visible !== false; });
      if (col === 'event') items = homeEvents(lists.event || [], lists.experience || []);
      renderList(box, items);
    });
    document.querySelectorAll('[data-cms-needs]').forEach(function (sec) {
      var col = sec.getAttribute('data-cms-needs');
      var toggle = single['toggle:' + sec.getAttribute('data-cms-show')];
      var has = (lists[col] || []).some(function (v) { return v.visible !== false && imageUrl(v); });
      sec.hidden = !has || (toggle && toggle.visible === false);
    });
    document.querySelectorAll('select[data-cms-roles]').forEach(function (sel) {
      var roles = (lists[sel.getAttribute('data-cms-roles')] || []).filter(function (v) { return v.visible !== false && v.title; });
      if (!roles.length) return;
      Array.prototype.slice.call(sel.options).forEach(function (o) { if (o.value) o.remove(); });
      roles.forEach(function (v) {
        var o = document.createElement('option'); o.value = v.title;
        o.textContent = v.title + (v.type ? ' (' + v.type + ')' : ''); sel.appendChild(o);
      });
    });
    var menuBox = document.querySelector('[data-cms-menu]');
    if (menuBox && lists.menu_category) renderMenu(menuBox, lists.menu_category, lists.menu_item || []);
    var cartMenu = document.querySelector('[data-cms-cart-menu]');
    if (cartMenu && lists.menu_item) renderCartMenu(cartMenu, lists.menu_item, lists.menu_category || []);
    var eventsBox = document.querySelector('[data-cms-events]');
    if (eventsBox && lists.event) renderEventCards(eventsBox, lists.event);
  }

  function renderList(box, items) {
    var tpl = box.querySelector('template');
    if (!tpl) return;
    Array.prototype.slice.call(box.children).forEach(function (c) { if (c !== tpl) c.remove(); });
    items.forEach(function (v) {
      var node = tpl.content.firstElementChild.cloneNode(true);
      fill(node, v);
      box.appendChild(node);
    });
  }

  function fill(node, v) {
    var targets = [node].concat(Array.prototype.slice.call(node.querySelectorAll('[data-f], [data-f-img]')));
    targets.forEach(function (el) {
      if (el.hasAttribute('data-f')) {
        var val = v[el.getAttribute('data-f')];
        el.textContent = val == null ? '' : String(val);
      }
      if (el.hasAttribute('data-f-img')) {
        var url = imageUrl(v);
        if (url) { el.src = url; el.alt = v.alt || ''; } else { el.remove(); }
      }
    });
  }

  // ---------- events ----------
  function todayIso() {
    var d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10);
  }
  function whenLabel(e) {
    if (e.status === 'upcoming' && e.date) {
      var d = new Date(e.date + 'T12:00:00');
      var s = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
      return s + (e.time ? ' · ' + e.time : '') + (e.location ? ' · ' + e.location : '');
    }
    return 'Planned — dates to be announced';
  }
  function splitEvents(events) {
    var t = todayIso();
    // hidden: switched off, or "announce from" date not reached yet
    var visible = events.filter(function (e) { return e.visible !== false && !(e.show_from && e.show_from > t); });
    var upcoming = visible.filter(function (e) { return e.status === 'upcoming' && e.date && e.date >= t; })
      .sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    var concepts = visible.filter(function (e) { return e.status !== 'upcoming'; });
    return { upcoming: upcoming, concepts: concepts };
  }
  // Homepage: dated upcoming events first, then the experience types RAAHA offers
  function homeEvents(events, experiences) {
    var up = splitEvents(events).upcoming.map(function (e) {
      return { title: e.title, when: whenLabel(e), description: e.description || '' };
    });
    var types = experiences.filter(function (x) { return x.visible !== false; })
      .map(function (x) { return { title: x.title, when: '', description: x.text }; });
    return up.concat(types);
  }
  function renderEventCards(box, events) {
    var parts = splitEvents(events);
    box.textContent = '';
    parts.upcoming.concat(parts.concepts).forEach(function (e) {
      var card = document.createElement('div'); card.className = 'upcoming-event-card';
      var pill = document.createElement('div'); pill.className = 'event-tag-pill';
      pill.textContent = e.status === 'upcoming' ? 'Upcoming' + (e.tag ? ' · ' + e.tag : '') : (e.tag || 'Future concept');
      var h = document.createElement('h3'); h.style.cssText = 'margin-bottom: 12px; font-size: 1.4rem;'; h.textContent = e.title;
      var p = document.createElement('p'); p.style.cssText = 'color: var(--text-muted); font-size: 0.95rem; margin-bottom: 12px;'; p.textContent = e.description || '';
      var w = document.createElement('p'); w.style.cssText = 'font-size: 0.85rem; margin-bottom: 0; color: var(--text-espresso); font-weight: 500;'; w.textContent = whenLabel(e);
      card.appendChild(pill); card.appendChild(h); card.appendChild(p); card.appendChild(w);
      if (e.status === 'upcoming' && imageUrl(e)) {
        var img = document.createElement('img'); img.src = imageUrl(e); img.alt = e.alt || ''; img.loading = 'lazy';
        img.style.cssText = 'width: 100%; height: 200px; object-fit: cover; border-radius: 8px; margin-bottom: 16px;';
        card.insertBefore(img, pill);
      }
      box.appendChild(card);
    });
  }

  // ---------- menu ----------
  function money(n, prefix) { return (prefix || '') + '$' + Number(n).toFixed(2); }
  function menuRow(name, price, prefix, desc, available, featured) {
    var row = document.createElement('div'); row.className = 'menu-item-row';
    var nm = document.createElement('div'); nm.className = 'menu-item-name';
    var h = document.createElement('h4'); h.textContent = name; nm.appendChild(h);
    if (featured) { var tag = document.createElement('span'); tag.textContent = ' Signature'; tag.style.cssText = 'font-size: 0.7rem; letter-spacing: 0.08em; text-transform: uppercase; color: #8F3E2E; margin-left: 6px;'; h.appendChild(tag); }
    if (desc) { var d = document.createElement('p'); d.textContent = desc; d.style.cssText = 'font-size: 0.85rem; color: var(--text-muted); margin: 2px 0 0;'; nm.appendChild(d); }
    var line = document.createElement('div'); line.className = 'menu-item-line';
    var pr = document.createElement('div'); pr.className = 'menu-item-price';
    pr.textContent = available === false ? 'Unavailable' : money(price, prefix);
    if (available === false) { pr.style.cssText = 'font-size: 0.85rem; color: var(--text-muted);'; h.style.opacity = '0.6'; }
    row.appendChild(nm); row.appendChild(line); row.appendChild(pr);
    return row;
  }
  function renderMenu(box, cats, items) {
    var visibleCats = cats.filter(function (c) { return c.visible !== false; });
    // Built-in category photos (in the page HTML) stay in place when a category has no photo set in Admin
    var builtIn = {};
    Array.prototype.forEach.call(box.querySelectorAll('.menu-category-block[id]'), function (b) {
      var im = b.querySelector('img.internal-page-hero-img');
      if (im) builtIn[b.id] = { src: im.getAttribute('src'), alt: im.getAttribute('alt') || '' };
    });
    box.textContent = '';
    visibleCats.forEach(function (c) {
      var its = items.filter(function (i) { return i.category === c.slug && i.visible !== false; });
      if (!its.length) return;
      var block = document.createElement('div'); block.className = 'menu-category-block'; block.id = 'cat-' + c.slug;
      var title = document.createElement('div'); title.className = 'menu-category-title'; title.textContent = c.name;
      block.appendChild(title);
      var url = imageUrl(c), alt = c.alt || '';
      if (!url && builtIn[block.id]) { url = builtIn[block.id].src; alt = builtIn[block.id].alt; }
      if (url) {
        var img = document.createElement('img'); img.className = 'internal-page-hero-img'; img.loading = 'lazy';
        img.src = url; img.alt = alt; img.style.marginBottom = '24px';
        if (applyPos(img, c)) {
          // zoomed: a frame the same shape as the photo keeps the enlarged photo inside its arch
          var frame = document.createElement('span'); frame.className = 'cat-photo'; frame.appendChild(img); block.appendChild(frame);
        } else block.appendChild(img);
      }
      var list = document.createElement('div'); list.className = 'menu-items-list';
      its.forEach(function (i) { list.appendChild(menuRow(i.name, i.price, c.price_prefix, i.description, i.available, i.featured)); });
      block.appendChild(list);
      box.appendChild(block);
    });
    var nav = document.querySelector('[data-cms-menu-nav]');
    if (nav) {
      nav.textContent = '';
      Array.prototype.forEach.call(box.querySelectorAll('.menu-category-block'), function (b) {
        var c = visibleCats.filter(function (x) { return 'cat-' + x.slug === b.id; })[0];
        var a = document.createElement('a'); a.href = '#' + b.id; a.className = 'filter-pill'; a.textContent = c.nav_label || c.name;
        a.addEventListener('click', function (e) { e.preventDefault(); b.scrollIntoView({ behavior: 'smooth' }); });
        nav.appendChild(a);
      });
    }
  }
  function onCart(i) { return i.cart === true || (i.cart == null && !!i.cart_section); }
  function renderCartMenu(box, items, cats) {
    var prefixFor = {};
    cats.forEach(function (c) { prefixFor[c.slug] = c.price_prefix || ''; });
    var groups = [];
    items.forEach(function (i) {
      if (!onCart(i) || i.visible === false) return;
      var sec = i.cart_section || 'Coffee Cart';
      var g = groups.filter(function (x) { return x.name === sec; })[0];
      if (!g) { g = { name: sec, items: [] }; groups.push(g); }
      g.items.push(i);
    });
    if (!groups.length) return;
    box.textContent = '';
    groups.forEach(function (g, idx) {
      var block = document.createElement('div'); block.className = 'menu-category-block';
      if (idx === groups.length - 1) block.style.marginBottom = '0';
      var title = document.createElement('div'); title.className = 'menu-category-title'; title.textContent = g.name;
      var list = document.createElement('div'); list.className = 'menu-items-list';
      g.items.forEach(function (i) { list.appendChild(menuRow(i.cart_label || i.name, i.price, prefixFor[i.category], '', i.available)); });
      block.appendChild(title); block.appendChild(list); box.appendChild(block);
    });
  }

  // ---------- draft preview bar ----------
  function previewBar(message) {
    var bar = document.createElement('div');
    bar.setAttribute('role', 'status');
    bar.style.cssText = 'position:fixed;left:12px;right:12px;bottom:12px;z-index:3000;background:#2E2A27;color:#F6F0E7;border-radius:10px;padding:10px 16px;font:14px/1.4 -apple-system,Segoe UI,Arial,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.25)';
    bar.textContent = (message || 'Sign in to the RAAHA admin on this browser to preview drafts.') + ' ';
    var a = document.createElement('a'); a.href = '/admin/'; a.textContent = 'Back to admin'; a.style.color = '#C9A86A';
    bar.appendChild(a);
    document.body.appendChild(bar);
    // keep draft mode while clicking around the site
    document.querySelectorAll('a[href^="/"]').forEach(function (link) {
      if (link.getAttribute('href').indexOf('/admin') === 0) return;
      var u = new URL(link.href, location.origin);
      u.searchParams.set('preview', 'draft');
      link.href = u.pathname + u.search + u.hash;
    });
  }
})();
