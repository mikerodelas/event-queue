(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var STORE = (Q.env.store || '').toUpperCase();
  if (!STORE) {
    document.body.innerHTML = '<div class="center-fill"><b>No store selected.</b><a class="btn btn-primary" target="_top" href="' + Q.esc(Q.link('landing')) + '">Choose a store</a></div>';
    return;
  }

  document.documentElement.setAttribute('data-theme', 'dark');
  var S = {
    snap: null, seq: -1, counterKey: '',
    sound: Q.store.get('q_disp_sound') !== '0',
    voice: Q.store.get('q_disp_voice') !== '0',
    audio: null, queue: [], announcing: false, wakeLock: null,
    themeVer: -1, imageV: 0
  };
  Q.theme.apply(document.body, Q.theme.DEFAULT);
  $('d-store').textContent = STORE;

  /* ---------- Clock ---------- */
  function tickClock() {
    $('d-clock').textContent = new Date().toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' });
  }
  tickClock(); setInterval(tickClock, 10000);

  /* ---------- Layout ---------- */
  function gridShape(n) {
    if (n <= 1) return [1, 1];
    if (n === 2) return [2, 1];
    if (n === 3) return [3, 1];
    if (n === 4) return [2, 2];
    if (n <= 6) return [3, 2];
    if (n <= 8) return [4, 2];
    if (n <= 9) return [3, 3];
    return [4, 3];
  }

  function buildTiles(counters) {
    var key = counters.map(function (c) { return c.no + ':' + (c.label || ''); }).join(',');
    if (key === S.counterKey) return;
    S.counterKey = key;
    var shape = gridShape(counters.length);
    var g = $('d-grid');
    g.style.gridTemplateColumns = 'repeat(' + shape[0] + ', 1fr)';
    g.style.gridTemplateRows = 'repeat(' + shape[1] + ', 1fr)';
    g.innerHTML = counters.map(function (c) {
      return '<div class="tile" id="tile-' + c.no + '"><div class="cn">' + Q.esc(c.label || 'Counter ' + c.no) + '</div><div class="wb num idle">—</div></div>';
    }).join('');
    sizeTiles();
  }

  function sizeTiles() {
    var t = document.querySelector('.tile');
    if (!t) return;
    var r = t.getBoundingClientRect();
    var fs = Math.max(24, Math.min(r.height * 0.58, r.width * 0.36));
    document.querySelectorAll('.tile .wb').forEach(function (el) { el.style.fontSize = fs + 'px'; });
  }
  window.addEventListener('resize', sizeTiles);

  /* ---------- Render ---------- */
  function render(snap) {
    var p = function (n) { return Q.pad(n, snap.pad); };
    $('d-ev').textContent = snap.title;
    document.title = snap.title + ' · ' + STORE;
    buildTiles(snap.counters);
    snap.counters.forEach(function (c) {
      var tile = $('tile-' + c.no);
      if (!tile) return;
      var wb = tile.querySelector('.wb');
      wb.textContent = c.wb ? p(c.wb) : '—';
      wb.classList.toggle('idle', !c.wb);
    });
    $('d-next').innerHTML = snap.next.length
      ? snap.next.map(function (n) { return '<div>' + p(n) + '</div>'; }).join('')
      : '<div class="d-empty">No one waiting</div>';
    $('d-missed').innerHTML = snap.missed.map(function (n) { return '<span>' + p(n) + '</span>'; }).join('');
    $('d-missed-note').textContent = snap.missed.length ? 'If your number is listed here, please approach any counter.' : 'No missed numbers.';
    $('d-waiting').textContent = snap.stats.waiting;
    $('d-served').textContent = snap.stats.served;
  }

  function detectCalls(prev, snap) {
    if (!prev) return [];
    var before = {};
    prev.counters.forEach(function (c) { before[c.no] = c; });
    return snap.counters.filter(function (c) {
      var b = before[c.no];
      return c.wb && (!b || b.wb !== c.wb || b.calledAt !== c.calledAt);
    }).sort(function (a, b) { return a.calledAt - b.calledAt; });
  }

  /* ---------- Announce ---------- */
  function chime() {
    if (!S.sound || !S.audio) return;
    try {
      var ctx = S.audio, t = ctx.currentTime;
      [[880, 0], [659.25, 0.32]].forEach(function (n) {
        var o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'sine'; o.frequency.value = n[0];
        g.gain.setValueAtTime(0.0001, t + n[1]);
        g.gain.exponentialRampToValueAtTime(0.35, t + n[1] + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + n[1] + 0.9);
        o.connect(g); g.connect(ctx.destination);
        o.start(t + n[1]); o.stop(t + n[1] + 1);
      });
    } catch (e) { /* ignore */ }
  }

  function speak(text) {
    return new Promise(function (resolve) {
      if (!S.voice || !window.speechSynthesis) return resolve();
      try {
        var u = new SpeechSynthesisUtterance(text);
        u.lang = 'en-US'; u.rate = 0.92;
        u.onend = u.onerror = function () { resolve(); };
        window.speechSynthesis.speak(u);
        setTimeout(resolve, 6000);
      } catch (e) { resolve(); }
    });
  }

  function announceNext() {
    if (S.announcing || !S.queue.length) return;
    S.announcing = true;
    var c = S.queue.shift();
    var label = Q.pad(c.wb, S.snap ? S.snap.pad : 3);
    var tile = $('tile-' + c.no);
    if (tile) {
      tile.classList.remove('flash'); void tile.offsetWidth; tile.classList.add('flash');
      clearTimeout(tile._flashT);
      tile._flashT = setTimeout(function () { tile.classList.remove('flash'); }, 5200);
    }
    $('co-num').textContent = label;
    $('co-ctr').textContent = c.label || 'Counter ' + c.no;
    $('callout').classList.remove('hidden');
    chime();
    var spoken = 'Number ' + c.wb + ', please proceed to ' + (c.custom ? c.label : 'counter ' + c.no) + '.';
    setTimeout(function () {
      speak(spoken).then(function () {
        setTimeout(function () {
          $('callout').classList.add('hidden');
          S.announcing = false;
          setTimeout(announceNext, 400);
        }, 1200);
      });
    }, 700);
  }

  /* ---------- Theme ---------- */
  function applyTheme(t) {
    if (!t || t.ver === S.themeVer) return;
    S.themeVer = t.ver;
    Q.theme.apply(document.body, t);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', t.bg);
    var v = t.image ? t.image.v : 0;
    if (v === S.imageV) return;
    var layer = $('d-bgimg');
    if (!v) { S.imageV = 0; layer.classList.remove('on'); layer.style.backgroundImage = ''; return; }
    Q.api('themeImage').then(function (img) {
      if (!img.dataUrl) return;
      var pre = new Image();
      pre.onload = function () {
        layer.style.backgroundImage = 'url("' + img.dataUrl + '")';
        layer.classList.add('on');
        S.imageV = img.v;
      };
      pre.src = img.dataUrl;
    }).catch(function () { S.themeVer = -1; /* retry on next poll */ });
  }

  /* ---------- Data ---------- */
  function setConn(ok) {
    $('d-dot').classList.toggle('off', !ok);
    $('d-conn-t').textContent = ok ? 'Live' : 'Reconnecting…';
  }

  function load() {
    return Q.api('display', { store: STORE }).then(function (snap) {
      setConn(true);
      if (S.snap && snap.now < S.snap.now) return; // stale
      var calls = S.snap && snap.seq !== S.seq ? detectCalls(S.snap, snap) : [];
      S.snap = snap; S.seq = snap.seq;
      applyTheme(snap.theme);
      render(snap);
      calls.forEach(function (c) { S.queue.push(c); });
      if (S.queue.length > 4) S.queue = S.queue.slice(-4); // never fall far behind during a rush
      announceNext();
    }).catch(function (err) {
      setConn(false);
      if (err.code === 'BAD_STORE' || err.code === 'CONFIG' || err.code === 'NOT_SETUP') $('d-conn-t').textContent = err.message;
      throw err;
    });
  }

  /* ---------- Controls ---------- */
  function syncTools() {
    $('t-sound').textContent = 'Sound: ' + (S.sound ? 'on' : 'off');
    $('t-voice').textContent = 'Voice: ' + (S.voice ? 'on' : 'off');
  }
  $('t-sound').addEventListener('click', function () { S.sound = !S.sound; Q.store.set('q_disp_sound', S.sound ? '1' : '0'); syncTools(); chime(); });
  $('t-voice').addEventListener('click', function () { S.voice = !S.voice; Q.store.set('q_disp_voice', S.voice ? '1' : '0'); syncTools(); });
  $('t-full').addEventListener('click', function () {
    var el = document.documentElement;
    try {
      if (document.fullscreenElement) document.exitFullscreen();
      else if (el.requestFullscreen) el.requestFullscreen().catch(function () { Q.toast('Use the browser’s fullscreen (F11 / kiosk mode).'); });
      else Q.toast('Use the browser’s fullscreen (F11 / kiosk mode).');
    } catch (e) { Q.toast('Use the browser’s fullscreen (F11 / kiosk mode).'); }
  });
  syncTools();

  function keepAwake() {
    if (!('wakeLock' in navigator) || document.hidden) return;
    navigator.wakeLock.request('screen').then(function (l) { S.wakeLock = l; }).catch(function () { /* not allowed */ });
  }
  document.addEventListener('visibilitychange', function () { if (!document.hidden) keepAwake(); });

  $('gate').addEventListener('click', function () {
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (AC) { S.audio = new AC(); S.audio.resume(); }
      if (window.speechSynthesis) window.speechSynthesis.speak(new SpeechSynthesisUtterance(' '));
    } catch (e) { /* ignore */ }
    $('gate').remove();
    keepAwake();
  });

  Q.poller(load, 3000).start();
})();
