(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };

  function render(data) {
    $('ev-title').textContent = data.title;
    document.title = data.title + ' · Queue';
    if (!data.stores.length) {
      $('stores').innerHTML = '<div class="card empty-state">No active stores. Check the Q_CONFIG tab.</div>';
      return;
    }
    $('stores').innerHTML = data.stores.map(function (s) {
      return '<div class="card store-card"><div><h2>' + Q.esc(s.name) + '</h2><span class="muted small">' + s.counters +
        ' counter' + (s.counters > 1 ? 's' : '') + '</span></div><div class="actions">' +
        '<a class="btn btn-primary" target="_top" href="' + Q.esc(Q.link('panel', s.name)) + '">Control panel</a>' +
        '<a class="btn btn-ghost" target="_top" href="' + Q.esc(Q.link('display', s.name)) + '">Queue display</a></div></div>';
    }).join('');
  }

  Q.api('bootstrap').then(render).catch(function (err) {
    $('stores').innerHTML = '<div class="card empty-state">' + Q.esc(err.message) + '</div>';
  });
})();
