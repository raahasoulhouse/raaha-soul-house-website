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
        A.toast('Photo details saved. Alt text reaches the website at the next publish.');
      });
    });
    var rep = el('label', 'Replace file', 'btn-like');
    rep.title = 'Upload a new version of this same photo. Every place using it updates at the next publish.';
    var file = A.input('file', null, { accept: 'image/jpeg,image/png,image/webp' }); file.hidden = true; rep.appendChild(file);
    file.addEventListener('change', function () {
      if (!file.files[0]) return;
      A.toast('Replacing…');
      M.replace(m, file.files[0]).then(function () { A.toast('Photo replaced. Publish to show it on the website.'); render(); })
        .catch(function (e) { A.toast(e.message, true); });
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
      msg.textContent = 'The photo is saved to your Photos library. Nothing changes on the website until you save and publish.'; msg.classList.remove('error');
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
            A.toast('Photo uploaded to your library and placed here. Save draft to keep it.');
          });
        }).catch(function (err) { go.disabled = false; fail(err.message || String(err)); });
      };
      $('picker-cancel').onclick = function () { dlg.close(); resolve(null); };
      dlg.onclose = function () { resolve(null); };
      dlg.showModal();
    });
  };

  // A photo field: value is {media_id} for library photos, or {static_src} for the photo built into the site.
  // onChange receives the new partial value.
  A.photoField = function (value, folderHint, onChange) {
    var box = el('div', null, 'photo-field');
    var img = el('img'); img.alt = '';
    var note = el('span', null, 'muted small');
    function show() {
      var m = value.media_id && M.byId(value.media_id);
      if (m) { img.src = M.thumbUrl(m) || ''; note.textContent = 'From photo library'; }
      else if (value.static_src) { img.src = value.static_src; note.textContent = 'Current website photo'; }
      else { img.removeAttribute('src'); note.textContent = 'No photo'; }
      img.hidden = !img.getAttribute('src');
    }
    var choose = el('button', 'Choose photo'); choose.type = 'button';
    choose.addEventListener('click', function () {
      M.pick(folderHint).then(function (m) {
        if (!m) return;
        value = Object.assign({}, value, { media_id: m.id });
        value.alt = m.alt_text || ''; // new photo: use its own description
        show(); onChange(value);
      });
    });
    var clear = el('button', 'Remove photo', 'link'); clear.type = 'button';
    clear.addEventListener('click', function () {
      value = Object.assign({}, value); delete value.media_id;
      show(); onChange(value);
    });
    box.appendChild(img); box.appendChild(note); box.appendChild(choose); box.appendChild(clear);
    show();
    return box;
  };

  A.modules.push({ tab: 'media', start: M.load, onShow: render });
})();
