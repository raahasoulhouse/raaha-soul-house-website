/* RAAHA admin — Photo library.
   Uploads are resized in the browser (max 1920px, WebP, plus a 600px thumbnail) and stored in the
   PRIVATE bucket. A public copy is made only when published content uses the photo. */
(function () {
  'use strict';
  var A = window.RAAHA_ADMIN, $ = A.$, el = A.el, db = A.db;
  var PRIVATE = 'media-private';
  var MAX = 1920, THUMB = 600, LIMIT = 5 * 1024 * 1024;
  var M = A.media = { rows: [], urls: {} };

  M.load = function () {
    return db.from('media').select('*').order('created_at', { ascending: false }).then(function (res) {
      if (res.error) throw res.error;
      M.rows = res.data;
      return signAll();
    });
  };
  function signAll() {
    var paths = [];
    M.rows.forEach(function (m) { paths.push(m.thumb_path || m.path); });
    if (!paths.length) return Promise.resolve();
    return db.storage.from(PRIVATE).createSignedUrls(paths, 3600).then(function (res) {
      (res.data || []).forEach(function (x) { if (x.signedUrl) M.urls[x.path] = x.signedUrl; });
    });
  }
  M.byId = function (id) { return M.rows.filter(function (m) { return m.id === id; })[0]; };
  M.thumbUrl = function (m) { return m ? M.urls[m.thumb_path || m.path] : null; };

  // ---------- where a photo is used ----------
  function refsIn(v, id) { return v && v.media_id === id; }
  function inUse(r, id) { return (!r.draft_deleted && refsIn(r.draft, id)) || refsIn(r.published_source, id) || refsIn(r.live_source, id); }
  M.usage = function (id) {
    return A.content.rows.filter(function (r) { return inUse(r, id); });
  };
  // Readable list of places: "Contact header photo (live, preview)"
  function describeUse(r, id) {
    var where = [];
    if (refsIn(r.live_source, id)) where.push('live');
    if (refsIn(r.published_source, id)) where.push('preview');
    if (!r.draft_deleted && refsIn(r.draft, id) && !refsIn(r.published_source, id)) where.push('unpublished draft');
    var name = A.content.describe ? A.content.describe(r) : r.collection;
    return name + (where.length ? ' (' + where.join(', ') + ')' : '');
  }
  M.whereUsed = function (id) {
    // checks the database directly (draft, preview and live), not just what this screen has loaded
    return db.from('cms_entries').select('id,collection,key,draft,draft_deleted,published_source,live_source')
      .or('draft->>media_id.eq.' + id + ',published_source->>media_id.eq.' + id + ',live_source->>media_id.eq.' + id)
      .then(function (res) {
        if (res.error) throw res.error;
        return res.data.filter(function (r) { return inUse(r, id); }).map(function (r) { return describeUse(r, id); });
      });
  };

  // ---------- resize in the browser ----------
  function toBlob(canvas, type, q) {
    return new Promise(function (ok) { canvas.toBlob(ok, type, q); });
  }
  function resize(file, max) {
    return createImageBitmap(file).then(function (bmp) {
      var scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
      var c = document.createElement('canvas');
      c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      return toBlob(c, 'image/webp', 0.82).then(function (b) {
        if (b && b.type === 'image/webp') return { blob: b, ext: 'webp', w: c.width, h: c.height };
        return toBlob(c, 'image/jpeg', 0.85).then(function (j) { return { blob: j, ext: 'jpg', w: c.width, h: c.height }; });
      });
    });
  }
  function prepare(file) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
      return Promise.reject(new Error(file.name + ': please use a JPG, PNG or WebP photo (iPhone: Settings → Camera → Formats → Most Compatible, or share/export as JPG).'));
    }
    return Promise.all([resize(file, MAX), resize(file, THUMB)]).then(function (r) {
      if (r[0].blob.size > LIMIT) throw new Error(file.name + ' is still over 5 MB after compressing.');
      return { full: r[0], thumb: r[1] };
    }).catch(function (e) {
      throw e.message && e.message.indexOf(file.name) === 0 ? e : new Error(file.name + ': this photo could not be read.');
    });
  }
  function uid() { return (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2)); }
  function store(folder, p) {
    var id = uid();
    var path = folder + '/' + id + '.' + p.full.ext, thumb = folder + '/' + id + '-thumb.' + p.thumb.ext;
    var opts = function (x) { return { contentType: x.blob.type, cacheControl: '31536000', upsert: false }; };
    return db.storage.from(PRIVATE).upload(path, p.full.blob, opts(p.full)).then(function (r) {
      if (r.error) throw r.error;
      return db.storage.from(PRIVATE).upload(thumb, p.thumb.blob, opts(p.thumb));
    }).then(function (r) {
      if (r.error) throw r.error;
      return { path: path, thumb_path: thumb, width: p.full.w, height: p.full.h, bytes: p.full.blob.size };
    });
  }

  M.upload = function (file, folder) {
    return prepare(file).then(function (p) { return store(folder, p); }).then(function (f) {
      f.folder = folder; f.alt_text = '';
      return db.from('media').insert(f).select().then(function (res) {
        if (res.error) throw res.error;
        M.rows.unshift(res.data[0]);
        return signAll().then(function () { return res.data[0]; });
      });
    });
  };

  // Replace keeps the same photo record (so every place using it updates at the next publish).
  // The old files are kept privately so "Undo" in Publishing can still restore earlier versions.
  M.replace = function (m, file) {
    return prepare(file).then(function (p) { return store(m.folder, p); }).then(function (f) {
      f.public_copy = false;
      return db.from('media').update(f).eq('id', m.id).select();
    }).then(function (res) {
      if (res.error) throw res.error;
      Object.assign(m, res.data[0]);
      // content using this photo becomes a pending change until published
      return Promise.all(M.usage(m.id).map(function (r) {
        var d = Object.assign({}, r.draft, { photo_version: m.path });
        return A.content.saveDraft(r, d);
      })).then(signAll);
    });
  };

  M.remove = function (m) {
    return M.whereUsed(m.id).then(function (places) {
      if (places.length) throw new Error('This photo is still used in ' + places.length + ' place(s): ' + places.join('; ') + '. Choose a different photo there and publish first.');
      var files = [m.path, m.thumb_path].filter(Boolean);
      return db.storage.from(PRIVATE).remove(files)
        .then(function () { return db.storage.from('site-media').remove(files); })
        .then(function () { return db.from('media').delete().eq('id', m.id); })
        .then(function (res) { if (res.error) throw res.error; M.rows = M.rows.filter(function (x) { return x.id !== m.id; }); });
    });
  };

  // ---------- library screen ----------
  function render() {
    var grid = $('media-grid'); grid.textContent = '';
    var f = $('m-filter').value;
    var list = M.rows.filter(function (m) { return !f || m.folder === f; });
    if (!list.length) { grid.appendChild(el('p', 'No photos yet. Upload authentic RAAHA photos above.', 'muted')); return; }
    list.forEach(function (m) { grid.appendChild(card(m)); });
  }
  function card(m) {
    var c = el('div', null, 'media-card');
    var img = el('img'); img.src = M.thumbUrl(m) || ''; img.alt = m.alt_text || ''; img.loading = 'lazy';
    c.appendChild(img);
    var uses = M.usage(m.id);
    c.appendChild(el('p', (m.width ? m.width + '×' + m.height + ' · ' : '') + Math.round((m.bytes || 0) / 1024) + ' KB · ' +
      (uses.length ? 'used in ' + uses.length + ' place(s)' : 'not used on the website') + (m.public_copy ? ' · public' : ' · private'), 'muted small'));
    if (uses.length) {
      var ul = el('ul', null, 'usage small');
      uses.forEach(function (r) { ul.appendChild(el('li', describeUse(r, m.id))); });
      c.appendChild(ul);
    }
    if (!m.alt_text) c.appendChild(el('p', 'Needs a photo description (add it below and Save).', 'small needs-alt'));
    var msg = el('p', null, 'small usage-msg'); msg.hidden = true;
    var alt = A.input('text', m.alt_text, { maxlength: 300, placeholder: 'Describe the photo for screen readers' });
    var desc = A.input('text', m.description, { maxlength: 1000, placeholder: 'Private note (optional)' });
    var folder = el('select');
    ['homepage', 'menu', 'events', 'gallery', 'coffee-cart', 'general'].forEach(function (v) { var o = el('option', v); o.value = v; folder.appendChild(o); });
    folder.value = m.folder;
    c.appendChild(A.field('Alt text', alt));
    c.appendChild(A.field('Note', desc));
    c.appendChild(A.field('Folder', folder));
    var row = el('div', null, 'row-actions');
    var save = el('button', 'Save'); save.type = 'button';
    save.addEventListener('click', function () {
      db.from('media').update({ alt_text: alt.value.trim(), description: desc.value.trim(), folder: folder.value }).eq('id', m.id).select().then(function (res) {
        if (res.error) { A.toast('Not saved: ' + res.error.message, true); return; }
        Object.assign(m, res.data[0]);
        var users = M.usage(m.id);
        if (!users.length) { A.toast('Photo details saved.'); return; }
        A.saveLive(users, null).then(function (r2) { if (!(r2 && r2.cancelled)) A.toast('Photo details saved and live.'); })
          .catch(function (e) { A.toast('Saved, but not live yet: ' + e.message, true); });
      });
    });
    var rep = el('label', 'Replace everywhere…', 'btn-like');
    rep.title = 'Swap this library photo for a new file in EVERY place that uses it. To change one page only, use Upload in that page’s section instead.';
    var file = A.input('file', null, { accept: 'image/jpeg,image/png,image/webp' }); file.hidden = true; rep.appendChild(file);
    file.addEventListener('click', function (e) {
      var places = M.usage(m.id).map(function (r) { return A.content.describe(r); });
      var msg = places.length
        ? 'This photo is used in ' + places.length + ' place(s):\n\n• ' + places.join('\n• ') + '\n\nReplacing it changes ALL of them on the live website.\nTo change one page only, cancel and use “Upload new photo” in that page’s section.'
        : 'This photo is not used on the website. Replace its file in the library?';
      if (!confirm(msg)) e.preventDefault();
    });
    file.addEventListener('change', function () {
      if (!file.files[0]) return;
      A.toast('Replacing…');
      var users = M.usage(m.id);
      A.saveLive(users, function () { return M.replace(m, file.files[0]); }).then(function (res) {
        if (res && res.cancelled) return;
        A.toast(users.length ? 'Photo replaced — live in ' + users.length + ' place(s).' : 'Photo replaced in the library.'); render();
      }).catch(function (e) { A.toast(e.message, true); render(); });
      file.value = '';
    });
    var del = el('button', 'Delete'); del.type = 'button';
    del.addEventListener('click', function () {
      del.disabled = true; msg.hidden = true;
      M.whereUsed(m.id).then(function (places) {
        del.disabled = false;
        if (places.length) {
          msg.textContent = 'Can’t delete: this photo is used in ' + places.join('; ') + '. Choose a different photo in those places and publish first.';
          msg.hidden = false; return;
        }
        if (!confirm('Delete this photo from the library permanently?\n\nIt is not used on the website (draft, preview or live). This cannot be undone. Older versions in Publishing history that used it will no longer show it if restored.')) return;
        return M.remove(m).then(function () { A.toast('Photo deleted.'); render(); });
      }).catch(function (e) { del.disabled = false; A.toast(e.message, true); });
    });
    row.appendChild(save); row.appendChild(rep); row.appendChild(del);
    c.appendChild(row);
    c.appendChild(msg);
    return c;
  }

  $('m-files').addEventListener('change', function (e) {
    var files = Array.prototype.slice.call(e.target.files);
    if (!files.length) return;
    var folder = $('m-folder').value, done = 0, errors = [];
    $('m-msg').textContent = 'Preparing ' + files.length + ' photo(s)…';
    files.reduce(function (p, f) {
      return p.then(function () {
        return M.upload(f, folder).then(function () { done++; $('m-msg').textContent = 'Uploaded ' + done + ' of ' + files.length + '…'; })
          .catch(function (err) { errors.push(err.message || String(err)); });
      });
    }, Promise.resolve()).then(function () {
      $('m-msg').textContent = done + ' uploaded (private until published).' + (errors.length ? ' Problems: ' + errors.join(' ') : '');
      e.target.value = '';
      render();
    });
  });
  $('m-filter').addEventListener('change', render);

  // ---------- picker used by every photo field ----------
  M.pick = function (folderHint) {
    return new Promise(function (resolve) {
      var dlg = $('picker'), grid = $('picker-grid');
      grid.textContent = '';
      var list = M.rows.slice().sort(function (a, b) { return (b.folder === folderHint) - (a.folder === folderHint); });
      if (!list.length) grid.appendChild(el('p', 'No photos yet — upload them in the Photos tab first.', 'muted'));
      list.forEach(function (m) {
        var b = el('button', null, 'pick'); b.type = 'button';
        var img = el('img'); img.src = M.thumbUrl(m) || ''; img.alt = m.alt_text || 'Photo';
        b.appendChild(img); b.appendChild(el('span', m.folder + (m.alt_text ? ' · ' + m.alt_text : ''), 'small'));
        b.addEventListener('click', function () { dlg.close(); resolve(m); });
        grid.appendChild(b);
      });
      // Upload a new photo right here (same library, same upload as the Photos tab)
      var form = $('picker-upload'), fileIn = $('pu-file'), altIn = $('pu-alt'), msg = $('pu-msg'), go = $('pu-go');
      form.reset(); $('pu-folder').value = folderHint || 'general'; go.disabled = false;
      msg.textContent = 'The photo is added to your Photos library. The website changes when you click Save in the section.'; msg.classList.remove('error');
      form.onsubmit = function (e) {
        e.preventDefault();
        var f = fileIn.files[0], alt = altIn.value.trim();
        function fail(t) { msg.textContent = t; msg.classList.add('error'); }
        if (!f) return fail('Choose a photo file first.');
        if (alt.length < 8) { altIn.focus(); return fail('Please describe what the photo shows (at least a few words) — it is read aloud to visitors using screen readers.'); }
        go.disabled = true; msg.classList.remove('error'); msg.textContent = 'Uploading…';
        M.upload(f, $('pu-folder').value).then(function (m) {
          return db.from('media').update({ alt_text: alt }).eq('id', m.id).then(function (res) {
            if (res.error) throw res.error;
            m.alt_text = alt; dlg.close(); resolve(m);
            A.toast('Photo placed here. Click Save in this section to put it on the website.');
          });
        }).catch(function (err) { go.disabled = false; fail(err.message || String(err)); });
      };
      $('picker-cancel').onclick = function () { dlg.close(); resolve(null); };
      dlg.onclose = function () { resolve(null); };
      dlg.showModal();
    });
  };

  // ---------- photo framing (display only; the uploaded file is never cropped) ----------
  // fx/fy/fz = desktop focus point (%) and zoom; mx/my/mz = phone. Stored in the content entry.
  A.POS_KEYS = ['fx', 'fy', 'fz', 'mx', 'my', 'mz'];
  // Size of each photo spot on the website (measured at 1440px desktop and 390px phone) and the
  // framing the site uses today, so the editor starts exactly where the website is. vh = visible height.
  var F = function (dw, dh, dx, dy, mw, mh, mx, my, o) { return Object.assign({ d: { w: dw, h: dh, x: dx, y: dy }, m: { w: mw, h: mh, x: mx, y: my } }, o || {}); };
  A.FRAMES = {
    'home.hero.image': F(1440, 788, 62, 58, 390, 740, 56, 88),
    'home.find.image': F(1440, 808, 50, 40, 390, 1153, 50, 30),
    'home.space.image': F(519, 649, 50, 50, 350, 438, 50, 50, { arch: true }),
    'home.cart.image': F(436, 273, 50, 50, 322, 201, 50, 50),
    'home.cart.inset': F(155, 211, 50, 50, 104, 141, 50, 50, { arch: true }),
    'home.community.image': F(492, 615, 62, 50, 350, 438, 62, 50, { arch: true }),
    'about.hero.image': F(1440, 648, 60, 40, 390, 608, 88, 40),
    'about.space.image': F(492, 615, 50, 60, 350, 385, 50, 60, { arch: true }),
    'about.experience.image': F(512, 640, 50, 60, 350, 385, 50, 60, { arch: true }),
    'menu.hero.image': F(1440, 397, 50, 55, 390, 326, 50, 45),
    'events.hero.image': F(1440, 397, 50, 40, 390, 402, 45, 40),
    'contact.hero.image': F(1440, 397, 50, 0, 390, 736, 46, 0, { mvh: 342 }),
    'cart.hero.image': F(1440, 648, 40, 50, 390, 608, 40, 50),
    'cart.intro.image': F(420, 525, 50, 45, 300, 315, 50, 45, { arch: true }),
    'menu': F(340, 425, 50, 50, 350, 197, 50, 50, { arch: true, marchOff: true })
  };
  function hasPos(v) { return A.POS_KEYS.some(function (k) { return v[k] != null; }); }

  // A photo field: value is {media_id} for library photos, or {static_src} for the photo built into the site.
  // onChange receives the new value. opts: {frame, builtIn, label}
  A.photoField = function (value, folderHint, onChange, opts) {
    opts = opts || {};
    var box = el('div', null, 'photo-field');
    var img = el('img'); img.alt = '';
    var note = el('span', null, 'muted small');
    var frame = A.FRAMES[opts.frame];
    function src() {
      var m = value.media_id && M.byId(value.media_id);
      if (m) return { url: M.thumbUrl(m), path: m.path, label: 'Your photo' };
      if (value.static_src) return { url: value.static_src, label: 'Photo built into the website' };
      if (opts.builtIn) return { url: opts.builtIn, label: 'Photo built into the website' };
      return null;
    }
    function show() {
      var s0 = src();
      if (s0 && s0.url) { img.src = s0.url; note.textContent = s0.label + (hasPos(value) ? ' · custom position' : ''); }
      else { img.removeAttribute('src'); note.textContent = 'No photo'; }
      img.hidden = !img.getAttribute('src');
      adjust.hidden = !frame || !(s0 && s0.url);
      clear.hidden = !value.media_id;
    }
    function set(nv, focusAlt) { value = nv; show(); var out = Object.assign({}, value); if (focusAlt) out._focusAlt = true; onChange(out); }
    function noPos(v) { var o = Object.assign({}, v); A.POS_KEYS.forEach(function (k) { delete o[k]; }); return o; }

    // 1. Upload a new photo straight into this spot (also added to the library for reuse)
    var up = el('label', 'Upload new photo', 'btn-like primary-like');
    var file = A.input('file', null, { accept: 'image/jpeg,image/png,image/webp' }); file.hidden = true; up.appendChild(file);
    file.addEventListener('change', function () {
      var f = file.files[0]; if (!f) return;
      note.textContent = 'Uploading…';
      M.upload(f, folderHint || 'general').then(function (m) {
        var nv = noPos(value); nv.media_id = m.id; nv.alt = '';
        set(nv, true);
        A.toast('Uploaded. Add a short description of the photo, then click Save.');
      }).catch(function (e) { show(); A.toast(e.message || String(e), true); });
      file.value = '';
    });
    // 2. Choose one already in the library
    var choose = el('button', 'Choose from library'); choose.type = 'button';
    choose.addEventListener('click', function () {
      M.pick(folderHint).then(function (m) {
        if (!m) return;
        var nv = noPos(value); nv.media_id = m.id; nv.alt = m.alt_text || '';
        set(nv, !nv.alt);
      });
    });
    // 3. Position / zoom
    var adjust = el('button', 'Adjust position'); adjust.type = 'button';
    adjust.addEventListener('click', function () {
      var s0 = src();
      A.positionEditor(frame, s0, value, opts.label).then(function (pos) {
        if (!pos) return;
        var nv = noPos(value);
        if (!pos.reset) A.POS_KEYS.forEach(function (k) { nv[k] = pos[k]; });
        set(nv);
      });
    });
    // 4. Back to the photo built into the website
    var clear = el('button', 'Use original website photo', 'link'); clear.type = 'button';
    clear.addEventListener('click', function () { set(noPos(Object.assign({}, value, { media_id: undefined, alt: '' }))); });
    box.appendChild(img); box.appendChild(note);
    var acts = el('div', null, 'photo-actions');
    [up, choose, adjust, clear].forEach(function (b) { acts.appendChild(b); });
    box.appendChild(acts);
    show();
    return box;
  };

  // ---------- position editor (drag to move, slider to zoom; desktop and phone separately) ----------
  A.positionEditor = function (frame, s0, value, label) {
    return new Promise(function (resolve) {
      var dlg = $('pos-dialog'), wrap = $('pos-previews');
      $('pos-title').textContent = 'Adjust position' + (label ? ' — ' + label : '');
      wrap.textContent = '';
      var state = {
        d: { x: num(value.fx, frame.d.x), y: num(value.fy, frame.d.y), z: num(value.fz, 1) },
        m: { x: num(value.mx, frame.m.x), y: num(value.my, frame.m.y), z: num(value.mz, 1) }
      };
      function num(v, d) { return v == null || v === '' || isNaN(Number(v)) ? d : Number(v); }
      var views = {};
      var urlP = s0.path ? db.storage.from(PRIVATE).createSignedUrl(s0.path, 3600).then(function (r) { return (r.data && r.data.signedUrl) || s0.url; }) : Promise.resolve(s0.url);
      urlP.then(function (url) {
        ['d', 'm'].forEach(function (k) { views[k] = view(k, url); wrap.appendChild(views[k].box); });
      });
      function view(k, url) {
        var fr = frame[k], maxW = k === 'd' ? 560 : 200, maxH = k === 'd' ? 320 : 380;
        var vh = k === 'm' && frame.mvh ? frame.mvh : fr.h;
        var sc = Math.min(maxW / fr.w, maxH / vh, 1);
        var box = el('div', null, 'pos-view');
        box.appendChild(el('h3', k === 'd' ? 'Desktop' : 'Phone'));
        var win = el('div', null, 'pos-frame' + (frame.arch && !(k === 'm' && frame.marchOff) ? ' arch' : ''));
        win.style.width = Math.round(fr.w * sc) + 'px'; win.style.height = Math.round(vh * sc) + 'px';
        var im = el('img'); im.src = url; im.alt = ''; im.draggable = false;
        im.style.width = Math.round(fr.w * sc) + 'px'; im.style.height = Math.round(fr.h * sc) + 'px';
        win.appendChild(im); box.appendChild(win);
        var zl = el('label', null, 'pos-zoom'); zl.appendChild(document.createTextNode('Zoom '));
        var z = A.input('range', state[k].z, { min: 1, max: 2.5, step: 0.05 }); zl.appendChild(z); box.appendChild(zl);
        var hint = el('p', 'Drag the photo to move it.', 'muted small'); box.appendChild(hint);
        function paint() {
          var p = state[k];
          im.style.objectPosition = p.x + '% ' + p.y + '%';
          im.style.transform = 'scale(' + p.z + ')';
          im.style.transformOrigin = p.x + '% ' + p.y + '%';
          z.value = p.z;
        }
        z.addEventListener('input', function () { state[k].z = Number(z.value); paint(); });
        var drag = null;
        win.addEventListener('pointerdown', function (e) {
          if (!im.naturalWidth) return;
          var W = fr.w * sc, H = fr.h * sc, cover = Math.max(W / im.naturalWidth, H / im.naturalHeight);
          var p = state[k];
          drag = { x: e.clientX, y: e.clientY, sx: p.x, sy: p.y,
            panX: p.z * (im.naturalWidth * cover - W) + (p.z - 1) * W,
            panY: p.z * (im.naturalHeight * cover - H) + (p.z - 1) * H };
          win.setPointerCapture(e.pointerId); win.classList.add('dragging');
        });
        win.addEventListener('pointermove', function (e) {
          if (!drag) return;
          var p = state[k];
          if (drag.panX > 1) p.x = clamp(drag.sx - (e.clientX - drag.x) / drag.panX * 100);
          if (drag.panY > 1) p.y = clamp(drag.sy - (e.clientY - drag.y) / drag.panY * 100);
          paint();
        });
        function end() { drag = null; win.classList.remove('dragging'); }
        win.addEventListener('pointerup', end); win.addEventListener('pointercancel', end);
        // keyboard: arrows move, +/- zoom
        win.tabIndex = 0; win.setAttribute('aria-label', (k === 'd' ? 'Desktop' : 'Phone') + ' photo position. Use arrow keys to move.');
        win.addEventListener('keydown', function (e) {
          var p = state[k], d = e.shiftKey ? 10 : 2;
          if (e.key === 'ArrowLeft') p.x = clamp(p.x - d); else if (e.key === 'ArrowRight') p.x = clamp(p.x + d);
          else if (e.key === 'ArrowUp') p.y = clamp(p.y - d); else if (e.key === 'ArrowDown') p.y = clamp(p.y + d);
          else return;
          e.preventDefault(); paint();
        });
        paint();
        return { box: box, paint: paint };
      }
      function clamp(n) { return Math.round(Math.min(100, Math.max(0, n)) * 10) / 10; }
      function close(v) { dlg.onclose = null; dlg.close(); resolve(v); }
      $('pos-reset').onclick = function () {
        state.d = { x: frame.d.x, y: frame.d.y, z: 1 }; state.m = { x: frame.m.x, y: frame.m.y, z: 1 };
        Object.keys(views).forEach(function (k) { views[k].paint(); });
        $('pos-reset').dataset.reset = '1';
      };
      $('pos-cancel').onclick = function () { close(null); };
      $('pos-ok').onclick = function () {
        var d = state.d, m = state.m;
        var untouched = d.x === frame.d.x && d.y === frame.d.y && d.z === 1 && m.x === frame.m.x && m.y === frame.m.y && m.z === 1;
        if (untouched) return close({ reset: true });
        close({ fx: d.x, fy: d.y, fz: d.z, mx: m.x, my: m.y, mz: m.z });
      };
      dlg.onclose = function () { resolve(null); };
      dlg.showModal();
    });
  };

  A.modules.push({ tab: 'media', start: M.load, onShow: render });
})();
