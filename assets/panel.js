(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var STORE = (Q.env.store || '').toUpperCase();
  var TOK_KEY = 'q_tok_' + STORE, CTR_KEY = 'q_ctr_' + STORE;
  var S = { token: Q.store.get(TOK_KEY), counter: parseInt(Q.store.get(CTR_KEY), 10) || 0, counters: 0, snap: null, tab: 'waiting', busy: false };
  var poll = null;

  function show(id) {
    ['s-loading', 's-login', 's-counter', 's-main', 's-theme'].forEach(function (s) { $(s).classList.toggle('hidden', s !== id); });
  }

  if (!STORE) {
    document.body.innerHTML = '<div class="center-fill"><b>No store selected.</b><a class="btn btn-primary" target="_top" href="' + Q.esc(Q.link('landing')) + '">Choose a store</a></div>';
    return;
  }
  $('login-store').textContent = STORE;
  $('t-store').textContent = STORE;
  $('back-link').href = Q.link('landing');

  /* ---------- Auth ---------- */
  function signOut(msg) {
    S.token = null; Q.store.del(TOK_KEY);
    if (poll) poll.stop();
    show('s-login');
    if (msg) Q.toast(msg, 'err');
    setTimeout(function () { $('pin').focus(); }, 50);
  }

  $('login-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var pin = $('pin').value.trim();
    if (!pin) return;
    $('login-btn').disabled = true;
    Q.api('login', { store: STORE, pin: pin }).then(function (res) {
      S.token = res.token; S.counters = res.counters;
      Q.store.set(TOK_KEY, res.token);
      $('pin').value = '';
      return loadPanel(true);
    }).catch(function (err) {
      Q.toast(err.message, 'err');
      $('pin').select();
    }).then(function () { $('login-btn').disabled = false; });
  });

  /* ---------- Counter selection ---------- */
  function pickCounter() {
    var snap = S.snap;
    $('counter-pick').innerHTML = snap.counters.map(function (c) {
      return '<button type="button" data-c="' + c.no + '" class="' + (c.wb ? 'busy' : '') + '"><b>Counter ' + c.no + '</b><span class="num">' +
        (c.wb ? 'Serving ' + Q.pad(c.wb, snap.pad) : 'Free') + '</span></button>';
    }).join('');
    show('s-counter');
  }
  $('counter-pick').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-c]');
    if (!b) return;
    S.counter = parseInt(b.getAttribute('data-c'), 10);
    Q.store.set(CTR_KEY, String(S.counter));
    show('s-main');
    render();
  });
  $('btn-counter').addEventListener('click', pickCounter);
  $('btn-lock').addEventListener('click', function () {
    Q.confirm('Lock this device?', 'You will need the store PIN to unlock it again.', 'Lock').then(function (ok) { if (ok) signOut(); });
  });

  /* ---------- Data ---------- */
  function setConn(ok) {
    $('conn').classList.toggle('off', !ok);
    $('t-sub').textContent = ok ? 'Live · Counter ' + S.counter : 'Reconnecting…';
  }

  function accept(snap) {
    if (S.snap && snap.now < S.snap.now) return; // stale poll result
    S.snap = snap;
    render();
  }

  function loadPanel(first) {
    return Q.api('panel', { store: STORE, token: S.token }).then(function (res) {
      S.counters = res.counters;
      setConn(true);
      accept(res.snapshot);
      if (first) {
        if (!(S.counter >= 1 && S.counter <= S.counters)) pickCounter();
        else { show('s-main'); render(); }
        loadTheme().catch(function () { /* swatches are cosmetic */ });
        if (!poll) poll = Q.poller(function () { if (!S.busy && S.token) return loadPanel(false); }, 4000);
        poll.start();
      }
    }).catch(function (err) {
      if (err.code === 'AUTH' || err.code === 'BAD_STORE') { signOut(first ? null : err.message); if (err.code === 'BAD_STORE') Q.toast(err.message, 'err'); return; }
      setConn(false);
      if (first) { show('s-login'); Q.toast(err.message, 'err'); }
      throw err;
    });
  }

  /* ---------- Actions ---------- */
  var LABELS = { next: 'Calling next…', recall: 'Recalling…', done: 'Completing…', noshow: 'Marking no-show…', call: 'Calling…', requeue: 'Returning to queue…' };

  function act(action, extra) {
    if (S.busy) return Promise.resolve();
    S.busy = true; setBusy(true);
    var payload = Object.assign({ store: STORE, token: S.token, counter: S.counter }, extra || {});
    return Q.api(action, payload).then(function (res) {
      accept(res.snapshot);
      var r = res.result || {};
      var p = function (n) { return Q.pad(n, S.snap.pad); };
      if (navigator.vibrate) navigator.vibrate(15);
      if (action === 'next') Q.toast(r.empty ? 'No one waiting right now.' : 'Called ' + p(r.wb) + ' to Counter ' + r.counter, r.empty ? '' : 'ok');
      else if (action === 'call') Q.toast('Called ' + p(r.wb) + ' to Counter ' + r.counter, 'ok');
      else if (action === 'recall') Q.toast('Recalled ' + p(r.wb));
      else if (action === 'done') Q.toast(p(r.wb) + ' served');
      else if (action === 'noshow') Q.toast(p(r.wb) + ' moved to Missed');
      else if (action === 'requeue') Q.toast(p(r.wb) + ' returned to queue');
    }).catch(function (err) {
      if (err.code === 'AUTH') return signOut(err.message);
      if (err.code === 'CONFIRM') {
        S.busy = false; setBusy(false);
        return Q.confirm('Please confirm', err.message, 'Call anyway').then(function (ok) {
          if (ok) return act(action, Object.assign({}, extra, { force: true }));
        });
      }
      Q.toast(err.message, 'err');
    }).then(function () { S.busy = false; setBusy(false); });
  }

  function setBusy(on) {
    ['btn-next', 'btn-recall', 'btn-noshow', 'btn-done'].forEach(function (id) { $(id).disabled = on || $(id).dataset.off === '1'; });
    document.body.style.cursor = on ? 'progress' : '';
    if (on) $('btn-next').textContent = LABELS.next;
    else render();
  }

  $('btn-next').addEventListener('click', function () { act('next'); });
  $('btn-recall').addEventListener('click', function () { act('recall'); });
  $('btn-done').addEventListener('click', function () { act('done'); });
  $('btn-noshow').addEventListener('click', function () {
    var c = currentHere();
    Q.confirm('Mark ' + Q.pad(c && c.wb, S.snap.pad) + ' as no-show?', 'It moves to the Missed list on the display. You can call it again later.', 'No-show', true)
      .then(function (ok) { if (ok) act('noshow'); });
  });
  $('manual').addEventListener('submit', function (e) {
    e.preventDefault();
    var v = $('manual-wb').value.replace(/\D/g, '');
    if (!v) return;
    var c = currentHere();
    var go = function () { act('call', { wb: v }).then(function () { $('manual-wb').value = ''; }); };
    if (c && c.wb) {
      Q.confirm('Call ' + Q.pad(+v, S.snap.pad) + '?', Q.pad(c.wb, S.snap.pad) + ' at this counter will be marked served.', 'Call').then(function (ok) { if (ok) go(); });
    } else go();
  });

  $('list').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-act]');
    if (!b) return;
    var wb = b.getAttribute('data-wb'), a = b.getAttribute('data-act');
    var label = Q.pad(+wb, S.snap.pad);
    if (a === 'call') {
      var c = currentHere();
      var text = c && c.wb ? Q.pad(c.wb, S.snap.pad) + ' at Counter ' + S.counter + ' will be marked served.' : 'Show ' + label + ' on the display for Counter ' + S.counter + '.';
      Q.confirm('Call ' + label + ' now?', text, 'Call').then(function (ok) { if (ok) act('call', { wb: wb }); });
    } else if (a === 'requeue') {
      Q.confirm('Return ' + label + ' to the queue?', 'It goes back in line by wristband number.', 'Return').then(function (ok) { if (ok) act('requeue', { wb: wb }); });
    }
  });

  document.querySelector('.tabs').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-tab]');
    if (!b) return;
    S.tab = b.getAttribute('data-tab');
    renderList();
  });

  /* ---------- Render ---------- */
  function currentHere() {
    if (!S.snap) return null;
    return S.snap.counters.filter(function (c) { return c.no === S.counter; })[0] || null;
  }

  function render() {
    var snap = S.snap;
    if (!snap || $('s-main').classList.contains('hidden')) return;
    var p = function (n) { return Q.pad(n, snap.pad); };
    var cur = currentHere();
    $('btn-counter').textContent = 'Counter ' + S.counter;
    $('t-sub').textContent = 'Live · Counter ' + S.counter;
    $('hero-label').textContent = 'Counter ' + S.counter + ' · Now serving';
    var has = cur && cur.wb;
    $('hero-num').textContent = has ? p(cur.wb) : '—';
    $('hero-num').classList.toggle('empty', !has);
    $('hero-who').innerHTML = has ? (cur.name ? Q.esc(cur.name) : '<span class="muted">No registration on file</span>') +
      (cur.calls > 1 ? '<span class="badge">Called ×' + cur.calls + '</span>' : '') : '';
    $('hero-meta').textContent = has ? ['Called ' + Q.ago(cur.calledAt), cur.phone].filter(Boolean).join(' · ') : 'Tap “Call next” to start.';

    var nextWb = snap.waiting.length ? snap.waiting[0].wb : 0;
    if (!S.busy) {
      $('btn-next').textContent = nextWb ? (has ? 'Done & call next · ' : 'Call next · ') + p(nextWb) : (has ? 'Done · queue empty' : 'Queue empty');
    }
    ['btn-recall', 'btn-noshow', 'btn-done'].forEach(function (id) { $(id).dataset.off = has ? '0' : '1'; $(id).disabled = S.busy || !has; });
    $('btn-next').dataset.off = (!nextWb && !has) ? '1' : '0';
    $('btn-next').disabled = S.busy || (!nextWb && !has);

    $('st-waiting').textContent = snap.stats.waiting;
    $('st-serving').textContent = snap.stats.serving;
    $('st-served').textContent = snap.stats.served;
    $('st-noshow').textContent = snap.stats.noShow;
    $('c-waiting').textContent = snap.waiting.length;
    $('c-missed').textContent = snap.noShows.length;
    $('c-served').textContent = snap.stats.served;
    $('c-review').textContent = snap.review.length || '';

    $('counters-strip').innerHTML = snap.counters.map(function (c) {
      return '<div class="cstrip' + (c.no === S.counter ? ' me' : '') + '"><span>Counter ' + c.no + '</span><b class="num">' + (c.wb ? p(c.wb) : '—') + '</b></div>';
    }).join('');
    renderList();
  }

  function row(n, title, sub, buttons, tag) {
    return '<div class="li"><div class="n num">' + n + '</div><div class="info"><b>' + (title || '<span class="muted">—</span>') +
      (tag ? ' <span class="tag">' + tag + '</span>' : '') + '</b><span>' + (sub || '') + '</span></div>' + (buttons || '') + '</div>';
  }
  function btn(act, wb, label, cls) {
    return '<button type="button" class="btn btn-sm ' + (cls || 'btn-ghost') + '" data-act="' + act + '" data-wb="' + wb + '">' + label + '</button>';
  }

  function renderList() {
    var snap = S.snap;
    if (!snap) return;
    document.querySelectorAll('.tabs button').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-tab') === S.tab); });
    var p = function (n) { return Q.pad(n, snap.pad); };
    var html = '';
    if (S.tab === 'waiting') {
      html = snap.waiting.slice(0, 120).map(function (w, i) {
        return row(p(w.wb), Q.esc(w.name), (i === 0 ? '<b style="color:var(--accent)">Next</b> · ' : '') + Q.esc(w.phone), btn('call', w.wb, 'Call here'), w.unregistered ? 'manual' : '');
      }).join('') || '<div class="empty-state">No one waiting. New registrations appear automatically.</div>';
      if (snap.waiting.length > 120) html += '<div class="empty-state">+' + (snap.waiting.length - 120) + ' more</div>';
    } else if (S.tab === 'missed') {
      html = snap.noShows.map(function (w) {
        return row(p(w.wb), Q.esc(w.name), 'Missed at Counter ' + w.counter + ' · ' + Q.ago(w.at), btn('requeue', w.wb, 'Return') + ' ' + btn('call', w.wb, 'Call', 'btn-primary'));
      }).join('') || '<div class="empty-state">No missed numbers.</div>';
    } else if (S.tab === 'served') {
      html = snap.served.map(function (w) {
        return row(p(w.wb), Q.esc(w.name), 'Counter ' + w.counter + ' · ' + Q.ago(w.at), btn('requeue', w.wb, 'Undo'));
      }).join('') || '<div class="empty-state">No one served yet.</div>';
    } else {
      html = snap.review.map(function (r) {
        if (r.type === 'INVALID') return row('?', Q.esc(r.name), 'Invalid wristband “' + Q.esc(r.raw) + '” · sheet row ' + r.row, '', 'invalid');
        return row(p(r.wb), Q.esc(r.name), 'Same wristband as ' + Q.esc(r.firstName) + ' · sheet row ' + r.row, '', 'duplicate');
      }).join('') || '<div class="empty-state">Nothing to review. Invalid or duplicated wristband entries from the form show up here.</div>';
    }
    $('list').innerHTML = html;
  }

  // Refresh "x ago" labels between polls
  setInterval(function () { if (S.snap && !S.busy) render(); }, 15000);

  /* ---------- Display style editor ---------- */
  var COLOR_FIELDS = [
    ['bg', 'Background', 'Behind everything'],
    ['tile', 'Cards', 'Counter tiles & side boxes'],
    ['text', 'Numbers & text', 'Main number color'],
    ['label', 'Labels', '“COUNTER 1”, “NEXT IN LINE”'],
    ['accent', 'Next number', 'First number in “Next in line”'],
    ['hot', 'Called / missed', 'Flash, callout & missed numbers']
  ];
  var TH = { saved: null, draft: null, image: null, imageV: 0, pendingImage: null, pendingRemove: false, dirty: false, saving: false };

  function swatches(t) {
    $('style-sw').innerHTML = ['bg', 'tile', 'text', 'hot'].map(function (k) { return '<i style="background:' + t[k] + '"></i>'; }).join('');
  }
  function loadTheme() {
    return Q.api('theme').then(function (t) { TH.saved = t; swatches(t); return t; });
  }

  $('th-colors').innerHTML = COLOR_FIELDS.map(function (f) {
    return '<label class="th-row"><div class="lbl"><b>' + f[1] + '</b><span>' + f[2] + '</span></div><span class="hex" id="hex-' + f[0] +
      '"></span><input type="color" data-k="' + f[0] + '" aria-label="' + f[1] + ' color"></label>';
  }).join('');
  $('presets').innerHTML = Q.theme.PRESETS.map(function (p, i) {
    return '<button type="button" class="preset" data-i="' + i + '"><span class="chip num" style="background:' + p.bg + ';color:' + p.text +
      ';box-shadow:inset 0 -10px 0 ' + p.tile + '"><span style="color:' + p.hot + '">0</span>12</span>' + Q.esc(p.name) + '</button>';
  }).join('');

  function renderEditor() {
    var t = TH.draft;
    Q.theme.apply($('pv'), t);
    $('pv').style.fontSize = ($('pv').clientWidth / 100) + 'px';
    COLOR_FIELDS.forEach(function (f) {
      var inp = document.querySelector('#th-colors input[data-k="' + f[0] + '"]');
      if (inp.value.toLowerCase() !== t[f[0]]) inp.value = t[f[0]];
      $('hex-' + f[0]).textContent = t[f[0]];
    });
    $('th-dim').value = Math.round(t.dim * 100); $('th-dim-v').textContent = Math.round(t.dim * 100) + '%';
    $('th-alpha').value = Math.round(t.tileAlpha * 100); $('th-alpha-v').textContent = Math.round(t.tileAlpha * 100) + '%';
    document.querySelectorAll('.preset').forEach(function (b) {
      var p = Q.theme.PRESETS[+b.getAttribute('data-i')];
      b.classList.toggle('on', ['bg', 'tile', 'text', 'label', 'accent', 'hot'].every(function (k) { return p[k] === t[k]; }));
    });
    var img = TH.pendingImage ? TH.pendingImage.dataUrl : (TH.pendingRemove ? '' : TH.image);
    $('pv-img').classList.toggle('on', !!img);
    $('pv-img').style.backgroundImage = img ? 'url("' + img + '")' : '';
    $('th-thumb').style.backgroundImage = img ? 'url("' + img + '")' : '';
    $('th-thumb').textContent = img ? '' : (t.image && !TH.pendingRemove && !TH.image ? 'Loading…' : 'None');
    $('th-img-remove').disabled = !img;
    var warn = [];
    if (Q.theme.contrast(t.text, t.tile) < 3) warn.push('Numbers may be hard to read on the cards (low contrast).');
    if (Q.theme.contrast(t.hot, t.tile) < 2) warn.push('Called/missed color is too close to the card color.');
    if (Q.theme.contrast(t.label, t.tile) < 2) warn.push('Labels are hard to see on the cards.');
    $('th-warn').textContent = warn.join(' ');
    $('th-warn').classList.toggle('hidden', !warn.length);
    ['th-save', 'th-save2'].forEach(function (id) { $(id).disabled = TH.saving || !TH.dirty; });
  }

  function change(patch) { Object.assign(TH.draft, patch); TH.dirty = true; renderEditor(); }

  function openEditor() {
    show('s-theme');
    window.scrollTo(0, 0);
    $('pv-ev').textContent = (S.snap && S.snap.title || '').toUpperCase();
    $('pv-st').textContent = STORE;
    TH.pendingImage = null; TH.pendingRemove = false; TH.dirty = false;
    var start = function (t) {
      TH.saved = t; TH.draft = Object.assign({}, Q.theme.DEFAULT, t);
      renderEditor();
      var v = t.image ? t.image.v : 0;
      if (v && v !== TH.imageV) {
        TH.image = null;
        Q.api('themeImage').then(function (img) { TH.image = img.dataUrl; TH.imageV = img.v; renderEditor(); })
          .catch(function () { Q.toast('Could not load current background image', 'err'); });
      } else if (!v) { TH.image = null; TH.imageV = 0; }
      renderEditor();
    };
    if (TH.saved) start(TH.saved);
    loadTheme().then(function (t) { if (!TH.dirty) start(t); }).catch(function (e) { Q.toast(e.message, 'err'); });
  }

  function closeEditor() { show('s-main'); render(); }

  $('open-style').addEventListener('click', openEditor);
  $('th-back').addEventListener('click', function () {
    if (!TH.dirty) return closeEditor();
    Q.confirm('Discard changes?', 'Your display style changes have not been saved.', 'Discard', true).then(function (ok) { if (ok) closeEditor(); });
  });
  $('th-colors').addEventListener('input', function (e) {
    var k = e.target.getAttribute('data-k');
    if (k) { var p = {}; p[k] = e.target.value.toLowerCase(); change(p); }
  });
  $('presets').addEventListener('click', function (e) {
    var b = e.target.closest('.preset');
    if (!b) return;
    var p = Q.theme.PRESETS[+b.getAttribute('data-i')];
    change({ bg: p.bg, tile: p.tile, text: p.text, label: p.label, accent: p.accent, hot: p.hot });
  });
  $('th-dim').addEventListener('input', function () { change({ dim: +$('th-dim').value / 100 }); });
  $('th-alpha').addEventListener('input', function () { change({ tileAlpha: +$('th-alpha').value / 100 }); });
  $('th-img-remove').addEventListener('click', function () {
    TH.pendingImage = null; TH.pendingRemove = !!(TH.saved && TH.saved.image); TH.dirty = true; renderEditor();
  });
  $('th-file').addEventListener('change', function () {
    var file = this.files && this.files[0];
    this.value = '';
    if (!file) return;
    if (!/^image\//.test(file.type)) return Q.toast('Please choose an image file', 'err');
    resizeImage(file, 1920).then(function (res) {
      TH.pendingImage = res; TH.pendingRemove = false; TH.dirty = true;
      if (TH.draft.dim < 0.35) TH.draft.dim = 0.55; // sensible default so numbers stay readable
      renderEditor();
    }).catch(function () { Q.toast('Could not read that image. Try a JPG or PNG.', 'err'); });
  });

  function resizeImage(file, max) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        var w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale);
        var c = document.createElement('canvas');
        c.width = w; c.height = h;
        var ctx = c.getContext('2d');
        ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        var q = 0.85, data = c.toDataURL('image/jpeg', q);
        while (data.length > 2400000 && q > 0.45) { q -= 0.1; data = c.toDataURL('image/jpeg', q); }
        resolve({ dataUrl: data, w: w, h: h });
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('decode')); };
      img.src = url;
    });
  }

  function saveTheme() {
    if (TH.saving || !TH.dirty) return;
    TH.saving = true; renderEditor();
    $('th-save2').textContent = 'Saving…';
    var auth = { store: STORE, token: S.token };
    var step = Promise.resolve();
    if (TH.pendingImage) {
      var pi = TH.pendingImage;
      step = Q.api('saveThemeImage', Object.assign({ dataUrl: pi.dataUrl, w: pi.w, h: pi.h }, auth)).then(function (t) { TH.image = pi.dataUrl; TH.imageV = t.image && t.image.v; });
    } else if (TH.pendingRemove) {
      step = Q.api('removeThemeImage', auth).then(function () { TH.image = null; TH.imageV = 0; });
    }
    var d = TH.draft;
    step.then(function () {
      return Q.api('saveTheme', Object.assign({ theme: { bg: d.bg, tile: d.tile, text: d.text, label: d.label, accent: d.accent, hot: d.hot, dim: d.dim, tileAlpha: d.tileAlpha } }, auth));
    }).then(function (t) {
      TH.saved = t; TH.draft = Object.assign({}, Q.theme.DEFAULT, t);
      TH.pendingImage = null; TH.pendingRemove = false; TH.dirty = false;
      swatches(t);
      Q.toast('Saved — all displays update within a few seconds', 'ok');
    }).catch(function (err) {
      if (err.code === 'AUTH') return signOut(err.message);
      Q.toast(err.message, 'err');
    }).then(function () { TH.saving = false; $('th-save2').textContent = 'Save for all displays'; if (TH.draft) renderEditor(); });
  }
  $('th-save').addEventListener('click', saveTheme);
  $('th-save2').addEventListener('click', saveTheme);
  $('th-reset').addEventListener('click', function () {
    Q.confirm('Reset display style?', 'All store displays go back to the default black theme and the background image is removed.', 'Reset', true).then(function (ok) {
      if (!ok) return;
      TH.saving = true; renderEditor();
      Q.api('resetTheme', { store: STORE, token: S.token }).then(function (t) {
        TH.saved = t; TH.draft = Object.assign({}, Q.theme.DEFAULT, t);
        TH.image = null; TH.imageV = 0; TH.pendingImage = null; TH.pendingRemove = false; TH.dirty = false;
        swatches(t);
        Q.toast('Display style reset', 'ok');
      }).catch(function (err) { Q.toast(err.message, 'err'); })
        .then(function () { TH.saving = false; renderEditor(); });
    });
  });
  window.addEventListener('resize', function () { if (TH.draft && !$('s-theme').classList.contains('hidden')) renderEditor(); });

  /* ---------- Boot ---------- */
  if (S.token) loadPanel(true).catch(function () { /* handled */ });
  else show('s-login');
})();
