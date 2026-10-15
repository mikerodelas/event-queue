/* Shared client core — works in Apps Script (google.script.run) and GitHub Pages (fetch). */
(function () {
  'use strict';
  var ENV = window.Q_ENV || {};
  var PAGES = window.Q_PAGES_CONFIG || {};

  function QError(message, code) { var e = new Error(message); e.code = code || 'ERROR'; return e; }

  function unwrap(res) {
    if (res && res.ok) return res.data;
    throw QError((res && res.error) || 'Unexpected server response', res && res.code);
  }

  function apiGas(action, payload) {
    return new Promise(function (resolve, reject) {
      google.script.run
        .withSuccessHandler(function (res) { try { resolve(unwrap(res)); } catch (e) { reject(e); } })
        .withFailureHandler(function (err) { reject(QError((err && err.message) || 'Network error', 'NETWORK')); })
        .api(action, payload || {});
    });
  }

  var GET_ACTIONS = { bootstrap: 1, display: 1 };
  function apiFetch(action, payload) {
    var url = PAGES.API_URL;
    if (!url || url.indexOf('script.google.com') < 0) {
      return Promise.reject(QError('API_URL is not set in config.js', 'CONFIG'));
    }
    var req;
    if (GET_ACTIONS[action]) {
      var qs = ['api=' + encodeURIComponent(action), '_=' + Date.now()];
      Object.keys(payload || {}).forEach(function (k) { qs.push(encodeURIComponent(k) + '=' + encodeURIComponent(payload[k])); });
      req = fetch(url + (url.indexOf('?') < 0 ? '?' : '&') + qs.join('&'), { method: 'GET', redirect: 'follow', cache: 'no-store' });
    } else {
      // text/plain keeps this a "simple" CORS request (no preflight, which Apps Script can't answer)
      req = fetch(url, {
        method: 'POST', redirect: 'follow', cache: 'no-store',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: action, payload: payload || {} })
      });
    }
    return req
      .catch(function () { throw QError('Network error — check connection', 'NETWORK'); })
      .then(function (r) {
        if (!r.ok) throw QError('Server error ' + r.status, 'NETWORK');
        return r.json().catch(function () { throw QError('Server returned an invalid response. Is the web app deployed for "Anyone"?', 'NETWORK'); });
      })
      .then(unwrap);
  }

  function api(action, payload) {
    return ENV.target === 'gas' ? apiGas(action, payload) : apiFetch(action, payload);
  }

  function link(view, store) {
    if (ENV.target === 'gas') {
      var u = ENV.baseUrl || '';
      if (view === 'landing') return u;
      return u + '?view=' + view + '&store=' + encodeURIComponent(store);
    }
    if (view === 'landing') return 'index.html';
    return view + '.html?store=' + encodeURIComponent(store);
  }

  var store = {
    get: function (k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { window.localStorage.setItem(k, v); } catch (e) { /* private mode */ } },
    del: function (k) { try { window.localStorage.removeItem(k); } catch (e) { /* ignore */ } }
  };

  function pad(n, len) {
    if (!n) return '—';
    var s = String(n);
    while (s.length < (len || 3)) s = '0' + s;
    return s;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function ago(ms, now) {
    if (!ms) return '';
    var s = Math.max(0, Math.round(((now || Date.now()) - ms) / 1000));
    if (s < 60) return s + 's ago';
    var m = Math.floor(s / 60);
    if (m < 60) return m + 'm ago';
    return Math.floor(m / 60) + 'h ' + (m % 60) + 'm ago';
  }

  function toast(msg, kind) {
    var wrap = document.querySelector('.toast-wrap');
    if (!wrap) { wrap = document.createElement('div'); wrap.className = 'toast-wrap'; document.body.appendChild(wrap); }
    var t = document.createElement('div');
    t.className = 'toast' + (kind ? ' ' + kind : '');
    t.textContent = msg;
    wrap.appendChild(t);
    setTimeout(function () { t.remove(); }, kind === 'err' ? 4500 : 2600);
  }

  function confirmBox(title, text, okLabel, danger) {
    return new Promise(function (resolve) {
      var back = document.createElement('div');
      back.className = 'modal-back';
      back.innerHTML = '<div class="modal" role="dialog" aria-modal="true"><h3>' + esc(title) + '</h3><p>' + esc(text) +
        '</p><div class="row"><button class="btn btn-ghost" data-v="0">Cancel</button><button class="btn ' +
        (danger ? 'btn-warn' : 'btn-primary') + '" data-v="1">' + esc(okLabel || 'OK') + '</button></div></div>';
      function done(v) { back.remove(); document.removeEventListener('keydown', onKey); resolve(v); }
      function onKey(e) { if (e.key === 'Escape') done(false); if (e.key === 'Enter') done(true); }
      back.addEventListener('click', function (e) {
        if (e.target === back) return done(false);
        var b = e.target.closest('button[data-v]');
        if (b) done(b.getAttribute('data-v') === '1');
      });
      document.addEventListener('keydown', onKey);
      document.body.appendChild(back);
      back.querySelector('[data-v="1"]').focus();
    });
  }

  /** Poll fn every `ms` while the page is visible; backs off on errors. */
  function poller(fn, ms) {
    var timer = null, fails = 0, stopped = false;
    function tick() {
      if (stopped) return;
      if (document.hidden) { timer = setTimeout(tick, ms); return; }
      Promise.resolve().then(fn).then(function () { fails = 0; }, function () { fails++; })
        .then(function () { if (!stopped) timer = setTimeout(tick, Math.min(ms * Math.pow(1.6, fails), 20000)); });
    }
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && !stopped) { clearTimeout(timer); tick(); }
    });
    return {
      start: function () { stopped = false; clearTimeout(timer); tick(); },
      stop: function () { stopped = true; clearTimeout(timer); },
      now: function () { clearTimeout(timer); tick(); }
    };
  }

  /* ---------- Display theme helpers (shared by display + panel preview) ---------- */
  var THEME_DEFAULT = { bg: '#000000', tile: '#141416', text: '#f5f5f7', label: '#8e8e93', accent: '#0a84ff', hot: '#ff9f0a', dim: 0.55, tileAlpha: 0.88 };
  var THEME_PRESETS = [
    { name: 'Midnight', bg: '#000000', tile: '#141416', text: '#f5f5f7', label: '#8e8e93', accent: '#0a84ff', hot: '#ff9f0a' },
    { name: 'Graphite', bg: '#1c1c1e', tile: '#2c2c2e', text: '#f2f2f7', label: '#aeaeb2', accent: '#64d2ff', hot: '#ffd60a' },
    { name: 'Sunset', bg: '#120a04', tile: '#24150a', text: '#fff4ea', label: '#c9a38a', accent: '#ffb340', hot: '#ff6a00' },
    { name: 'Deep Blue', bg: '#031025', tile: '#0b2347', text: '#eaf2ff', label: '#8fa9cf', accent: '#5ac8fa', hot: '#ffd60a' },
    { name: 'Sage', bg: '#0d1a14', tile: '#16281f', text: '#eef7f1', label: '#8fb3a0', accent: '#30d158', hot: '#ffd60a' },
    { name: 'Silver', bg: '#f5f5f7', tile: '#ffffff', text: '#1d1d1f', label: '#6e6e73', accent: '#0071e3', hot: '#d70015' }
  ];

  function rgb(hex) {
    var h = String(hex || '#000000').replace('#', '');
    return [parseInt(h.slice(0, 2), 16) || 0, parseInt(h.slice(2, 4), 16) || 0, parseInt(h.slice(4, 6), 16) || 0];
  }
  function rgba(hex, a) { var c = rgb(hex); return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; }
  /** amount of `top` blended over `base` → rgb() string */
  function mix(top, base, amount) {
    var a = rgb(top), b = rgb(base);
    return 'rgb(' + [0, 1, 2].map(function (i) { return Math.round(a[i] * amount + b[i] * (1 - amount)); }).join(',') + ')';
  }
  function luminance(hex) {
    return rgb(hex).map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); })
      .reduce(function (s, v, i) { return s + v * [0.2126, 0.7152, 0.0722][i]; }, 0);
  }
  function contrast(a, b) {
    var x = luminance(a), y = luminance(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  }
  /** Sets the --d-* CSS variables the display (and preview) read from. */
  function applyTheme(el, t) {
    t = Object.assign({}, THEME_DEFAULT, t || {});
    var s = el.style;
    s.setProperty('--d-bg', t.bg);
    s.setProperty('--d-tile', rgba(t.tile, t.tileAlpha));
    s.setProperty('--d-tile-solid', t.tile);
    s.setProperty('--d-text', t.text);
    s.setProperty('--d-dim', t.label);
    s.setProperty('--d-accent', t.accent);
    s.setProperty('--d-hot', t.hot);
    s.setProperty('--d-idle', mix(t.text, t.tile, 0.22));
    s.setProperty('--d-empty', mix(t.text, t.tile, 0.3));
    s.setProperty('--d-hot-soft', mix(t.hot, t.tile, 0.22));
    s.setProperty('--d-flash', mix(t.hot, t.tile, 0.28));
    s.setProperty('--d-overlay', rgba(t.bg, t.dim));
    s.setProperty('--d-callout', rgba(t.bg, 0.97));
    s.setProperty('--d-line', mix(t.text, t.tile, 0.18));
    if (el === document.body) document.documentElement.style.background = t.bg;
  }

  window.Q = {
    env: ENV, api: api, link: link, store: store, pad: pad, esc: esc, ago: ago, toast: toast, confirm: confirmBox, poller: poller,
    theme: { DEFAULT: THEME_DEFAULT, PRESETS: THEME_PRESETS, apply: applyTheme, contrast: contrast, mix: mix }
  };
})();
