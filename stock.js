(function () {
  'use strict';
  // Página de stock: lee y escribe solo state.stock y state.stockLoc del mismo almacenamiento que index.html.
  var DB = window.ALBION_DB, REC = window.ALBION_REC;
  var LS = 'regear-albion-v1', LS_THEME = 'regear-albion-theme';
  var NOPLACE = '';
  var SLOTS = [{ id: 'weapon', label: 'Arma' }, { id: 'offhand', label: 'Mano secundaria' }, { id: 'head', label: 'Cabeza' },
    { id: 'armor', label: 'Armadura' }, { id: 'shoes', label: 'Botas' }, { id: 'cape', label: 'Capa' }];
  // «Especiales»: items caros que no entran en las builds de regear.
  var SPECIAL = [{ id: 'mount', label: 'Monturas' }, { id: 'bag', label: 'Bolsos' }, { id: 'potion', label: 'Pociones' }, { id: 'food', label: 'Comida' }];
  var SPECIAL_IDS = SPECIAL.map(function (x) { return x.id; });
  var DEFS = DB.map(function (r) { return { key: r[0], slot: r[1], tiers: r[2], ench: r[3], nameEn: r[4], name: r[6] || r[4], two: r[5] === 1 }; });
  var byKey = new Map(DEFS.map(function (d) { return [d.key, d]; }));
  var fmt = new Intl.NumberFormat('es-CL');

  function $(s) { return document.querySelector(s); }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function plain(s) { return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }
  function pickName(n, tier) { return typeof n === 'string' ? n : (n[String(tier)] || n[Object.keys(n)[0]]); }
  function tagText(t, e) { return 'T' + t + (e ? '.' + e : ''); }
  function tagHtml(t, e) { return '<span class="tag t' + t + '"><span>T' + t + '</span>' + (e ? '<span class="e e' + e + '">.' + e + '</span>' : '') + '</span>'; }

  /* ---------- Estado (se conserva el resto del JSON tal cual) ---------- */
  var raw = {}, stock = {}, loc = {}, moves = [];
  function load() {
    try { raw = JSON.parse(lsGet(LS) || '{}') || {}; } catch (e) { raw = {}; }
    stock = {}; loc = {};
    // moves: [fecha 'YYYY-MM-DD hh:mm:ss', jugador, id, cantidad (+ingreso / -retiro), lugar]
    moves = (Array.isArray(raw.moves) ? raw.moves : []).filter(function (m) { return Array.isArray(m) && m.length >= 5 && typeof m[2] === 'string' && +m[3]; })
      .map(function (m) { return [String(m[0]).slice(0, 19), String(m[1]).slice(0, 40), m[2], Math.round(+m[3]), String(m[4] || '').slice(0, 40)]; }).slice(-5000);
    var s = raw.stock || {}, l = raw.stockLoc || {};
    Object.keys(s).forEach(function (id) { var v = Math.round(+s[id]); if (v > 0 && /^T\d_[A-Za-z0-9_]+(@\d)?$/.test(id)) stock[id] = Math.min(v, 99999); });
    Object.keys(stock).forEach(function (id) {
      var m = l[id]; if (!m || typeof m !== 'object') return;
      var clean = {}, sum = 0;
      Object.keys(m).forEach(function (k) { var v = Math.min(Math.round(+m[k]), stock[id] - sum); if (k && v > 0) { clean[k] = v; sum += v; } });
      if (sum) loc[id] = clean;
    });
  }
  function save() {
    raw.stock = stock; raw.stockLoc = loc; raw.moves = moves.slice(-5000);
    if (!lsSet(LS, JSON.stringify(raw))) flash('No se pudo guardar en este navegador.');
  }
  function unassigned(id) { var m = loc[id] || {}; return (stock[id] || 0) - Object.keys(m).reduce(function (a, k) { return a + m[k]; }, 0); }
  // Cambia la cantidad de un lugar ('' = sin lugar) y el total en el mismo paso.
  function change(id, place, delta) {
    var have = place === NOPLACE ? unassigned(id) : ((loc[id] || {})[place] || 0), d = Math.max(delta, -have);
    d = Math.min(d, 99999 - (stock[id] || 0));
    if (!d) return;
    if (place !== NOPLACE) {
      var m = loc[id] || (loc[id] = {});
      m[place] = have + d;
      if (m[place] <= 0) delete m[place];
      if (!Object.keys(m).length) delete loc[id];
    }
    stock[id] = (stock[id] || 0) + d;
    if (stock[id] <= 0) { delete stock[id]; delete loc[id]; }
  }
  function setPlaceQty(id, place, n) {
    var have = place === NOPLACE ? unassigned(id) : ((loc[id] || {})[place] || 0);
    change(id, place, clamp(Math.round(+n) || 0, 0, 99999) - have);
  }

  /* ---------- Items y materiales ---------- */
  function parse(id) {
    var m = /^T(\d)_(.+?)(?:@(\d))?$/.exec(id);
    if (!m) return null;
    var tier = +m[1], ench = +(m[3] || 0), def = byKey.get(m[2]);
    if (def) return { id: id, kind: SPECIAL_IDS.indexOf(def.slot) >= 0 ? 'special' : 'items', slot: def.slot, tier: tier, ench: ench, name: pickName(def.name, tier), alt: pickName(def.nameEn, tier), two: def.two };
    if (REC.N[id]) return { id: id, kind: 'mats', slot: /_ARTEFACT_/.test(id) ? 'art' : 'mat', tier: tier, ench: ench, name: REC.N[id], alt: '' };
    return null;
  }
  var MATS = Object.keys(REC.N).map(parse).filter(Boolean);

  function iconHtml(id, label) {
    return '<span class="ic sm" aria-hidden="true"><span class="ph">' + esc(label.charAt(0)) + '</span><img src="https://render.albiononline.com/v1/item/' + esc(id) + '.png?size=64" alt="" loading="lazy" decoding="async"></span>';
  }
  function wireIcons(root) {
    root.querySelectorAll('.ic img').forEach(function (img) {
      if (img.dataset.wired) return;
      img.dataset.wired = '1';
      function ok() { if (img.naturalWidth > 0) img.parentNode.classList.add('ok'); else fail(); }
      function fail() { if (img.parentNode) img.remove(); }
      if (img.complete) ok(); else { img.addEventListener('load', ok); img.addEventListener('error', fail); }
    });
  }

  /* ---------- Vista ---------- */
  var view = { tab: 'items', q: '', place: '*', group: 'type', eq: true, kind: 'all', player: '' };
  var flashT = null;
  function flash(msg, ms) { var el = $('#sk-status'); el.textContent = msg; clearTimeout(flashT); flashT = setTimeout(function () { el.textContent = ''; }, ms || 4000); }
  function knownPlaces() {
    var set = {};
    Object.keys(loc).forEach(function (id) { Object.keys(loc[id]).forEach(function (k) { set[k] = true; }); });
    return Object.keys(set).sort(function (a, b) { return a.localeCompare(b); });
  }
  function entries() { return Object.keys(stock).map(parse).filter(Boolean); }
  function qtyIn(e, place) {
    if (view.place === '*') return stock[e.id];
    return view.place === NOPLACE ? unassigned(e.id) : ((loc[e.id] || {})[view.place] || 0);
  }

  function placeRow(id, name, place, qty, label) {
    return '<li class="pl"><span class="pl-name' + (place === NOPLACE ? ' none' : '') + '">' + esc(place === NOPLACE ? 'Sin lugar' : place) + '</span>' +
      '<span class="stk"><button type="button" class="step sm" data-act="dec" data-id="' + esc(id) + '" data-place="' + esc(place) + '" aria-label="Quitar uno en ' + esc(place || 'sin lugar') + '">−</button>' +
      '<input class="st-in" type="number" inputmode="numeric" min="0" max="99999" value="' + qty + '" data-id="' + esc(id) + '" data-place="' + esc(place) + '" aria-label="Cantidad de ' + esc(label) + ' en ' + esc(place || 'sin lugar') + '">' +
      '<button type="button" class="step sm" data-act="inc" data-id="' + esc(id) + '" data-place="' + esc(place) + '" aria-label="Agregar uno en ' + esc(place || 'sin lugar') + '">+</button></span>' +
      (place !== NOPLACE ? '<button type="button" class="x sm" data-act="rm" data-id="' + esc(id) + '" data-place="' + esc(place) + '" aria-label="Quitar ' + esc(place) + '">×</button>' : '') + '</li>';
  }
  var lastMove = {};
  function indexMoves() {
    lastMove = {};
    moves.forEach(function (m) { if (!lastMove[m[2]] || m[0] >= lastMove[m[2]][0]) lastMove[m[2]] = m; });
  }
  function lastNote(id) {
    var m = lastMove[id];
    return m ? '<span class="r-state lm" title="' + esc(m[0]) + '">Último: ' + esc(m[1]) + ' (' + (m[3] > 0 ? '+' : '') + m[3] + ')</span>' : '';
  }
  // Equivalencia: mismo item con igual nivel (tier + encantamiento) cuenta como un solo stock.
  function eqRows(rows) {
    var cl = {}, order = [];
    rows.forEach(function (e) {
      var k = e.id.replace(/^T\d_/, '').replace(/@\d$/, '') + '|' + (e.tier + e.ench);
      if (!cl[k]) { cl[k] = []; order.push(k); }
      cl[k].push(e);
    });
    return order.map(function (k) {
      var g = cl[k];
      if (g.length < 2) return rowHtml(g[0]);
      var rep = g.slice().sort(function (a, b) { return b.tier - a.tier; })[0], tot = g.reduce(function (a, e) { return a + qtyIn(e); }, 0);
      var parts = g.map(function (e) { return 'T' + e.tier + '.' + e.ench + ' ×' + fmt.format(qtyIn(e)); }).join(' + ');
      return '<li class="eq-grp"><details open><summary class="row sk-row"><div class="r-lab">' + iconHtml(rep.id, rep.name) + '<span class="r-txt"><span class="r-name">' + esc(rep.name) + '</span>' +
        '<span class="r-meta"><span class="r-state">Nivel ' + (rep.tier + rep.ench) + ' equivalente · ' + esc(parts) + '</span></span></span></div><span class="r-count">×' + fmt.format(tot) + '</span></summary><ul>' + g.map(rowHtml).join('') + '</ul></details></li>';
    }).join('');
  }
  function rowHtml(e) {
    var id = e.id, m = loc[id] || {}, none = unassigned(id);
    var places = Object.keys(m).sort(function (a, b) { return a.localeCompare(b); }).map(function (k) { return placeRow(id, e.name, k, m[k], e.name); });
    if (none > 0 || !places.length) places.unshift(placeRow(id, e.name, NOPLACE, none, e.name));
    return '<li class="row sk-row" data-id="' + esc(id) + '"><div class="r-lab">' + iconHtml(id, e.name) + '<span class="r-txt"><span class="r-name">' + esc(e.name) + '</span>' +
      '<span class="r-meta">' + tagHtml(e.tier, e.ench) + (e.two ? '<span class="two">2H</span>' : '') + lastNote(id) + '</span></span></div>' +
      '<span class="r-count" aria-label="' + stock[id] + ' en total">×' + fmt.format(stock[id]) + '</span>' +
      '<ul class="pls">' + places.join('') + '</ul>' +
      '<form class="pl-add" data-id="' + esc(id) + '"><input class="pk-q sm" list="places" name="place" placeholder="Lugar" maxlength="40" autocomplete="off" aria-label="Lugar para ' + esc(e.name) + '">' +
      '<input class="pk-q sm n" name="qty" type="number" min="1" max="99999" value="1" aria-label="Cantidad">' +
      '<button class="btn" type="submit">Agregar aquí</button></form></li>';
  }

  function updateCounts() {
    var all = entries(), sum = { items: 0, mats: 0, special: 0 };
    all.forEach(function (e) { sum[e.kind] += stock[e.id]; });
    $('#n-special').textContent = fmt.format(sum.special);
    $('#n-items').textContent = fmt.format(sum.items);
    $('#n-mats').textContent = fmt.format(sum.mats);
  }
  function render() {
    var all = entries(), q = plain(view.q.trim());
    indexMoves();
    var items = all.filter(function (e) { return e.kind === 'items'; }), mats = all.filter(function (e) { return e.kind === 'mats'; }), specials = all.filter(function (e) { return e.kind === 'special'; });
    var byTab = { items: items, mats: mats, special: specials };
    updateCounts();
    document.querySelectorAll('.tabs [data-tab]').forEach(function (b) { b.setAttribute('aria-selected', String(b.dataset.tab === view.tab)); });

    var places = knownPlaces(), cur = view.place;
    if (cur !== '*' && cur !== NOPLACE && places.indexOf(cur) < 0) cur = view.place = '*';
    $('#sk-place').innerHTML = '<option value="*"' + (cur === '*' ? ' selected' : '') + '>Todos los lugares</option><option value=""' + (cur === NOPLACE ? ' selected' : '') + '>Sin lugar</option>' +
      places.map(function (p) { return '<option' + (p === cur ? ' selected' : '') + ' value="' + esc(p) + '">' + esc(p) + '</option>'; }).join('');
    $('#places').innerHTML = places.map(function (p) { return '<option value="' + esc(p) + '">'; }).join('');

    var isMoves = view.tab === 'moves';
    $('#mv-bar').hidden = !isMoves; $('#sk-add').hidden = isMoves; $('#sk-group').hidden = isMoves || view.tab === 'moves';
    $('#n-moves').textContent = fmt.format(moves.length);
    if (isMoves) { $('#sk-places').innerHTML = ''; renderMoves(); return; }
    $('#sk-group').value = view.group;
    var list = byTab[view.tab].filter(function (e) {
      return (!q || plain(e.name).indexOf(q) >= 0 || (e.alt && plain(e.alt).indexOf(q) >= 0)) && qtyIn(e) > 0;
    });
    // Resumen por lugar de la pestaña activa
    var tot = {}, base = byTab[view.tab];
    base.forEach(function (e) {
      var m = loc[e.id] || {}, un = unassigned(e.id);
      Object.keys(m).forEach(function (k) { tot[k] = (tot[k] || 0) + m[k]; });
      if (un > 0) tot[NOPLACE] = (tot[NOPLACE] || 0) + un;
    });
    var keys = Object.keys(tot).sort(function (a, b) { return a === NOPLACE ? 1 : b === NOPLACE ? -1 : a.localeCompare(b); });
    $('#sk-places').innerHTML = keys.map(function (k) {
      return '<button type="button" class="chip pl-chip" data-place="' + esc(k) + '" aria-pressed="' + (view.place === k) + '">' + esc(k === NOPLACE ? 'Sin lugar' : k) + ' <b>' + fmt.format(tot[k]) + '</b></button>';
    }).join('');

    if (view.group === 'place') {
      var bk = {};
      list.forEach(function (e) {
        var m = loc[e.id] || {}, un = unassigned(e.id);
        Object.keys(m).forEach(function (k) { (bk[k] = bk[k] || []).push([e, m[k]]); });
        if (un > 0) (bk[NOPLACE] = bk[NOPLACE] || []).push([e, un]);
      });
      var hp = Object.keys(bk).filter(function (k) { return view.place === '*' || view.place === k; })
        .sort(function (a, b) { return a === NOPLACE ? 1 : b === NOPLACE ? -1 : a.localeCompare(b); }).map(function (k) {
          var rows = bk[k].sort(function (a, b) { return (b[0].tier + b[0].ench) - (a[0].tier + a[0].ench) || b[0].tier - a[0].tier || a[0].name.localeCompare(b[0].name); });
          return '<section class="grp"><h3><span>' + esc(k === NOPLACE ? 'Sin lugar' : k) + '</span><span class="sub">' + fmt.format(rows.reduce(function (a, r) { return a + r[1]; }, 0)) + '</span></h3><ul>' + rows.map(function (r) {
            var e = r[0];
            return '<li class="row sk-row" data-id="' + esc(e.id) + '"><div class="r-lab">' + iconHtml(e.id, e.name) + '<span class="r-txt"><span class="r-name">' + esc(e.name) + '</span><span class="r-meta">' + tagHtml(e.tier, e.ench) + (e.two ? '<span class="two">2H</span>' : '') + lastNote(e.id) + '</span></span></div>' +
              '<span class="r-count">×' + fmt.format(r[1]) + '</span><ul class="pls">' + placeRow(e.id, e.name, k, r[1], e.name) + '</ul></li>';
          }).join('') + '</ul></section>';
        }).join('');
      $('#sk-body').innerHTML = hp || '<p class="empty">No hay resultados con ese filtro.</p>';
      wireIcons($('#sk-body'));
      return;
    }
    var groups = view.tab === 'items' ? SLOTS.map(function (s) { return [s.id, s.label]; }) : view.tab === 'special' ? SPECIAL.map(function (s) { return [s.id, s.label]; }) : [['art', 'Artefactos'], ['mat', 'Materiales']], html = '';
    groups.forEach(function (g) {
      var rows = list.filter(function (e) { return e.slot === g[0]; }).sort(function (a, b) { return (b.tier + b.ench) - (a.tier + a.ench) || b.tier - a.tier || a.name.localeCompare(b.name); });
      if (!rows.length) return;
      html += '<section class="grp"><h3><span>' + g[1] + '</span><span class="sub">' + fmt.format(rows.reduce(function (a, e) { return a + qtyIn(e); }, 0)) + '</span></h3><ul>' + (view.eq && view.tab === 'items' ? eqRows(rows) : rows.map(rowHtml).join('')) + '</ul></section>';
    });
    $('#sk-body').innerHTML = html || '<p class="empty">' + (all.length || view.q ? 'No hay resultados con ese filtro.' : 'Aún no hay stock. Usa «+ Agregar» para anotar lo que tienes y dónde está.') + '</p>';
    wireIcons($('#sk-body'));
  }
  function renderMoves() {
    var q = plain(view.q.trim()), byP = {}, rows = moves.filter(function (m) {
      var e = parse(m[2]);
      if (view.kind === 'in' && m[3] < 0) return false;
      if (view.kind === 'out' && m[3] > 0) return false;
      if (view.place !== '*' && m[4] !== view.place) return false;
      if (q && plain(m[1] + ' ' + (e ? e.name : '')).indexOf(q) < 0) return false;
      return true;
    });
    rows.forEach(function (m) { var o = byP[m[1]] || (byP[m[1]] = { name: m[1], in: 0, out: 0 }); if (m[3] > 0) o.in += m[3]; else o.out += -m[3]; });
    var players = Object.keys(byP).sort(function (a, b) { return (byP[b].in + byP[b].out) - (byP[a].in + byP[a].out); });
    $('#mv-player').innerHTML = '<option value="">Todos los jugadores</option>' + Object.keys(moves.reduce(function (a, m) { a[m[1]] = 1; return a; }, {})).sort().map(function (n) { return '<option' + (n === view.player ? ' selected' : '') + ' value="' + esc(n) + '">' + esc(n) + '</option>'; }).join('');
    $('#mv-kind').value = view.kind;
    if (view.player) rows = rows.filter(function (m) { return m[1] === view.player; });
    var shown = rows.slice().sort(function (a, b) { return a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0; }).slice(0, 400);
    $('#sk-body').innerHTML = (players.length ? '<div class="mv-sum">' + players.map(function (n) {
      return '<button type="button" class="chip pl-chip" data-player="' + esc(n) + '" aria-pressed="' + (view.player === n) + '">' + esc(n) + ' <b class="up">+' + fmt.format(byP[n].in) + '</b> <b class="down">−' + fmt.format(byP[n].out) + '</b></button>';
    }).join('') + '</div>' : '') +
      (shown.length ? '<ul class="mv-list">' + shown.map(function (m) {
        var e = parse(m[2]);
        return '<li class="mv"><span class="mv-d">' + esc(m[0]) + '</span><b class="mv-p">' + esc(m[1]) + '</b><span class="mv-q ' + (m[3] > 0 ? 'up' : 'down') + '">' + (m[3] > 0 ? 'ingresó +' : 'sacó −') + Math.abs(m[3]) + '</span><span class="mv-i">' + (e ? esc(e.name) + ' ' + tagHtml(e.tier, e.ench) : esc(m[2])) + '</span><span class="mv-pl">' + esc(m[4] || 'Sin lugar') + '</span></li>';
      }).join('') + '</ul>' + (rows.length > shown.length ? '<p class="hint">Mostrando los ' + shown.length + ' más recientes de ' + rows.length + '.</p>' : '')
        : '<p class="empty">' + (moves.length ? 'No hay movimientos con ese filtro.' : 'Aún no hay movimientos. Importa el registro del banco para ver quién ingresa y quién saca items.') + '</p>');
    wireIcons($('#sk-body'));
  }
  function commit(focusSel) { save(); render(); if (focusSel) { var el = document.querySelector(focusSel); if (el) el.focus(); } }
  function sel(id, place) { return '.st-in[data-id="' + id + '"][data-place="' + place.replace(/"/g, '\\"') + '"]'; }

  $('#sk-body').addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-act]');
    if (!b) return;
    var id = b.dataset.id, place = b.dataset.place, act = b.dataset.act;
    if (act === 'rm') { setPlaceQty(id, place, 0); commit(); return; }
    change(id, place, act === 'inc' ? 1 : -1);
    commit(sel(id, place));
  });
  $('#sk-body').addEventListener('change', function (ev) {
    var t = ev.target;
    if (!t.classList.contains('st-in')) return;
    setPlaceQty(t.dataset.id, t.dataset.place, t.value);
    save();
    // Sin reconstruir la lista: el cambio puede venir de un clic en otro botón y se perdería. Se actualizan solo los totales.
    var row = t.closest('.row'), id = t.dataset.id;
    if (row) row.querySelector('.r-count').textContent = '×' + fmt.format(stock[id] || 0);
    t.value = t.dataset.place === NOPLACE ? unassigned(id) : ((loc[id] || {})[t.dataset.place] || 0);
    updateCounts();
  });
  $('#sk-body').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var f = ev.target, place = f.place.value.trim().slice(0, 40), n = clamp(parseInt(f.qty.value, 10) || 1, 1, 99999);
    change(f.dataset.id, place, n); commit();
  });
  $('.tabs').addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-tab]');
    if (b) { view.tab = b.dataset.tab; render(); }
  });
  $('#sk-eq').addEventListener('change', function (ev) { view.eq = ev.target.checked; render(); });
  $('#sk-group').addEventListener('change', function (ev) { view.group = ev.target.value === 'place' ? 'place' : 'type'; render(); });
  $('#mv-kind').addEventListener('change', function (ev) { view.kind = ev.target.value; render(); });
  $('#mv-player').addEventListener('change', function (ev) { view.player = ev.target.value; render(); });
  $('#sk-body').addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-player]');
    if (b) { view.player = view.player === b.dataset.player ? '' : b.dataset.player; render(); }
  });
  $('#sk-q').addEventListener('input', function (ev) { view.q = ev.target.value; render(); });
  $('#sk-place').addEventListener('change', function (ev) { view.place = ev.target.value; render(); });
  $('#sk-places').addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-place]');
    if (b) { view.place = view.place === b.dataset.place ? '*' : b.dataset.place; render(); }
  });
  var clearT = null;
  $('#sk-clear').addEventListener('click', function () {
    var b = this;
    if (!clearT) { b.textContent = '¿Vaciar todo?'; b.classList.add('armed'); clearT = setTimeout(function () { clearT = null; b.textContent = 'Vaciar'; b.classList.remove('armed'); }, 3500); return; }
    clearTimeout(clearT); clearT = null; b.textContent = 'Vaciar'; b.classList.remove('armed');
    stock = {}; loc = {}; raw.taken = {}; raw.checked = {};
    save(); render(); flash('Stock vaciado (items y materiales).');
  });

  /* ---------- Registro del banco (movimientos) ---------- */
  var TIER_WORDS = { principiante: 1, novato: 2, obrero: 3, iniciado: 4, experto: 5, maestro: 6, 'gran maestro': 7, anciano: 8 };
  var equipIdx = null, matIdx = null;
  function buildIdx() {
    if (equipIdx) return;
    equipIdx = {}; matIdx = {};
    DEFS.forEach(function (d) {
      for (var t = 1; t <= 8; t++) if ((d.tiers >> t) & 1) {
        var k = plain(pickName(d.name, t)) + '|' + t;
        (equipIdx[k] = equipIdx[k] || []).push(d);
      }
    });
    Object.keys(REC.N).forEach(function (id) { var k = plain(REC.N[id]); (matIdx[k] = matIdx[k] || []).push(id); });
  }
  function resolveObject(obj, ench) {
    buildIdx();
    var e = clamp(parseInt(ench, 10) || 0, 0, 4), m = /^(.*?)\s+del?\s+(principiante|novato|obrero|iniciado|experto|maestro|gran maestro|anciano)\s*$/i.exec(obj.trim());
    if (m) {
      var tier = TIER_WORDS[plain(m[2])], c = equipIdx[plain(m[1]) + '|' + tier] || [];
      c = c.filter(function (d) { return e === 0 || ((d.ench >> (e - 1)) & 1) === 1; });
      if (c.length === 1) return { id: 'T' + tier + '_' + c[0].key + (e ? '@' + e : '') };
      if (c.length > 1) return { error: 'ambiguo (' + c.length + ' items con ese nombre)' };
    }
    var ids = (matIdx[plain(obj.trim())] || []).filter(function (id) { var x = /@(\d)$/.exec(id); return (x ? +x[1] : 0) === e; });
    if (ids.length === 1) return { id: ids[0] };
    if (ids.length > 1) return { error: 'ambiguo (' + ids.length + ' tiers con ese nombre)' };
    return { error: 'no reconocido' };
  }
  function isoDate(t) {
    var m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}:\d{2}:\d{2})/.exec(t.trim());
    return m ? m[3] + '-' + ('0' + m[1]).slice(-2) + '-' + ('0' + m[2]).slice(-2) + ' ' + ('0' + m[4]).slice(-8) : t.trim().slice(0, 19);
  }
  function parseLog(text) {
    var out = { rows: [], bad: 0 };
    text.split(/\r?\n/).forEach(function (line, i) {
      if (!line.trim()) return;
      var f = line.match(/"([^"]*)"/g);
      f = f && f.length >= 6 ? f.map(function (x) { return x.slice(1, -1); }) : line.split('\t');
      if (f.length < 6) { out.bad++; return; }
      if (i === 0 && /fecha/i.test(f[0])) return;
      var q = parseInt(f[5], 10);
      if (!q) { out.bad++; return; }
      out.rows.push({ sig: f.slice(0, 6).join('|'), date: isoDate(f[0]), player: f[1].trim(), obj: f[2], ench: f[3], qty: q });
    });
    return out;
  }
  var lgPlan = null;
  function planLog() {
    var p = parseLog($('#lg-text').value), seen = Object.assign({}, raw.logSeen || {}), net = {}, bad = {}, skipped = 0, used = {}, mv = [], before = 0,
      since = ($('#lg-since').value || '').trim().replace('T', ' ');
    p.rows.forEach(function (r) {
      if (since && r.date < since) { before++; return; }
      if ((seen[r.sig] || 0) > 0) { seen[r.sig]--; skipped++; return; }
      used[r.sig] = (used[r.sig] || 0) + 1;
      var res = resolveObject(r.obj, r.ench);
      if (res.error) { var k = r.obj + ' (.' + (parseInt(r.ench, 10) || 0) + ') — ' + res.error; bad[k] = (bad[k] || 0) + Math.abs(r.qty); return; }
      net[res.id] = (net[res.id] || 0) + r.qty;
      mv.push([r.date, r.player, res.id, r.qty]);
    });
    var dates = p.rows.map(function (r) { return r.date; }).filter(Boolean).sort();
    return { lines: p.rows.length, badLines: p.bad, skipped: skipped, net: net, bad: bad, used: used, moves: mv, before: before,
      from: dates[0] || '', to: dates[dates.length - 1] || '', fresh: p.rows.length - skipped - before };
  }
  // Historial de cargas: se guarda dentro de logSeen (clave reservada) para que viaje con la nube.
  var HIST = '#hist';
  function logHist() { var h = (raw.logSeen || {})[HIST]; return Array.isArray(h) ? h : []; }
  function histHtml() {
    var h = logHist();
    if (!h.length) return '';
    return '<p class="lg-bad">Cargas anteriores (la última primero):</p><ul class="lg-list">' + h.slice().reverse().slice(0, 12).map(function (e) {
      return '<li>' + esc(e.at) + ' · registro ' + esc(e.from || '?') + ' → ' + esc(e.to || '?') + ' · ' + e.applied + ' líneas nuevas, ' + e.skipped + ' repetidas · ' + esc(e.place || 'sin lugar') + '</li>';
    }).join('') + '</ul>';
  }
  function nowStamp() { var d = new Date(), p = function (n) { return String(n).padStart(2, '0'); }; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()); }
  function renderPlan(pl) {
    var ids = Object.keys(pl.net).filter(function (id) { return pl.net[id] !== 0; });
    ids.sort(function (a, b) { var x = parse(a), y = parse(b); return (y.tier + y.ench) - (x.tier + x.ench) || x.name.localeCompare(y.name); });
    var pos = ids.filter(function (id) { return pl.net[id] > 0; }).length, neg = ids.length - pos;
    var last = logHist().slice(-1)[0], cmp = '';
    if (pl.lines && !pl.fresh) cmp = '<p class="lg-bad">Este registro ya está subido por completo: no hay líneas nuevas, no se cargará nada.</p>';
    else if (pl.skipped) cmp = '<p class="lg-sum">Comparado con lo ya subido: <b>' + pl.skipped + '</b> de ' + pl.lines + ' líneas se repiten y se ignoran; solo se cargan <b>' + pl.fresh + '</b> nuevas.</p>';
    if (last && pl.from && last.to && pl.to < last.to && pl.fresh) cmp += '<p class="lg-bad">Ojo: hay líneas nuevas con fecha anterior a la última carga (' + esc(last.to) + '). Revisa que no sea otro registro.</p>';
    $('#lg-out').innerHTML = cmp + '<p class="lg-sum"><b>' + pl.lines + '</b> líneas leídas · <b>' + pl.skipped + '</b> ya aplicadas antes · <b>' + (pl.before || 0) + '</b> anteriores a «Desde» · <b>' + ids.length + '</b> items con movimiento neto (' + pos + ' suben, ' + neg + ' bajan)' +
      (pl.badLines ? ' · ' + pl.badLines + ' líneas ilegibles' : '') + '</p>' +
      (ids.length ? '<ul class="lg-list">' + ids.map(function (id) {
        var e = parse(id), n = pl.net[id];
        return '<li><span class="lg-n ' + (n > 0 ? 'up' : 'down') + '">' + (n > 0 ? '+' : '') + n + '</span> ' + esc(e.name) + ' ' + tagHtml(e.tier, e.ench) + ((stock[id] || 0) + n < 0 ? ' <span class="miss">retira más de lo que hay en stock</span>' : '') + '</li>';
      }).join('') + '</ul>' : '') +
      (Object.keys(pl.bad).length ? '<p class="lg-bad">Sin reconocer (no se cargan):</p><ul class="lg-list">' + Object.keys(pl.bad).map(function (k) { return '<li>' + esc(k) + ' · ' + pl.bad[k] + '</li>'; }).join('') + '</ul>' : '') + histHtml();
  }
  // Quita primero del lugar indicado, luego de otros lugares y al final de «sin lugar».
  function removeFrom(id, place, n) {
    var order = [place].concat(Object.keys(loc[id] || {}).filter(function (k) { return k !== place; })).concat([NOPLACE]);
    order.forEach(function (pl) { if (n > 0) { var have = pl === NOPLACE ? unassigned(id) : ((loc[id] || {})[pl] || 0), d = Math.min(n, have); if (d > 0) { change(id, pl, -d); n -= d; } } });
  }
  $('#lg-file').addEventListener('change', function (ev) {
    var f = ev.target.files && ev.target.files[0];
    if (!f) return;
    var rd = new FileReader();
    rd.onload = function () { $('#lg-text').value = String(rd.result); lgPlan = planLog(); renderPlan(lgPlan); $('#lg-apply').disabled = !Object.keys(lgPlan.net).length; };
    rd.readAsText(f);
  });
  $('#lg-prev').addEventListener('click', function () { lgPlan = planLog(); renderPlan(lgPlan); $('#lg-apply').disabled = !Object.keys(lgPlan.net).length; });
  $('#lg-apply').addEventListener('click', function () {
    lgPlan = planLog();
    var place = $('#lg-place').value.trim().slice(0, 40), n = 0;
    Object.keys(lgPlan.net).forEach(function (id) {
      var d = lgPlan.net[id];
      if (d > 0) change(id, place, d); else if (d < 0) removeFrom(id, place, -d);
      if (d) n++;
    });
    lgPlan.moves.forEach(function (m) { moves.push([m[0], m[1], m[2], m[3], place]); });
    moves.sort(function (a, b) { return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0; });
    var seen = raw.logSeen || (raw.logSeen = {});
    Object.keys(lgPlan.used).forEach(function (sg) { seen[sg] = (seen[sg] || 0) + lgPlan.used[sg]; });
    var hist = logHist().slice(-49);
    hist.push({ at: nowStamp(), from: lgPlan.from, to: lgPlan.to, lines: lgPlan.lines, applied: lgPlan.fresh, skipped: lgPlan.skipped, place: place });
    seen[HIST] = hist;
    var keys = Object.keys(seen).filter(function (k) { return k !== HIST; }); if (keys.length > 20000) keys.slice(0, keys.length - 20000).forEach(function (k) { delete seen[k]; });
    save(); render();
    $('#lg-out').innerHTML = histHtml(); $('#lg-apply').disabled = true;
    flash(n + ' items actualizados y ' + lgPlan.moves.length + ' movimientos registrados en «' + (place || 'sin lugar') + '».', 9000);
  });

  /* ---------- Carga rápida desde las builds ---------- */
  function buildItems() {
    var need = {};
    (raw.builds || []).forEach(function (b) {
      var w = b.slots && b.slots.weapon, two = w && byKey.get(w.key) && byKey.get(w.key).two, pl = Math.max(1, Math.min(99, +b.players || 1));
      Object.keys(b.slots || {}).forEach(function (k) {
        var it = b.slots[k];
        if (!it || !byKey.has(it.key) || (k === 'offhand' && two)) return;
        var id = 'T' + (+it.tier) + '_' + it.key + (+it.ench ? '@' + (+it.ench) : '');
        need[id] = (need[id] || 0) + pl * (Math.max(1, +it.qty || 1));
      });
    });
    return Object.keys(need).map(function (id) { var e = parse(id); e.need = need[id]; return e; }).filter(Boolean)
      .sort(function (a, b) { return (b.tier + b.ench) - (a.tier + a.ench) || b.tier - a.tier || a.name.localeCompare(b.name); });
  }
  function renderQuick() {
    var rows = buildItems();
    $('#qk-body').innerHTML = rows.length ? '<div class="qk-list">' + rows.map(function (e) {
      return '<label class="qk-row">' + iconHtml(e.id, e.name) + '<span class="qk-n">' + esc(e.name) + ' ' + tagHtml(e.tier, e.ench) + '<small>Piden las builds: ' + e.need + '</small></span>' +
        '<input class="st-in" type="number" min="0" max="99999" inputmode="numeric" data-id="' + esc(e.id) + '" placeholder="—" value="' + (stock[e.id] || '') + '" aria-label="Tienes de ' + esc(e.name) + '"></label>';
    }).join('') + '</div>' : '<p class="empty">No hay builds con items. Crea o importa builds primero.</p>';
    wireIcons($('#qk-body'));
  }
  $('#qk').addEventListener('toggle', function () { if (this.open) { load(); renderQuick(); } });
  $('#qk-save').addEventListener('click', function () {
    var place = $('#qk-place').value.trim().slice(0, 40), n = 0;
    document.querySelectorAll('#qk-body input[data-id]').forEach(function (i) {
      if (i.value === '') return;
      var id = i.dataset.id, target = clamp(Math.round(+i.value) || 0, 0, 99999), delta = target - (stock[id] || 0);
      if (!delta) return;
      change(id, place, delta); n++;
    });
    save(); render(); renderQuick();
    flash(n ? n + ' items actualizados en «' + (place || 'sin lugar') + '».' : 'No había cambios que guardar.', 8000);
  });

  /* ---------- Cargar / copiar JSON ---------- */
  $('#sk-load').addEventListener('click', function () {
    var data, n = 0, bad = 0;
    try { data = JSON.parse($('#sk-json').value); } catch (e) { flash('El texto no es JSON válido.', 6000); return; }
    if (!Array.isArray(data)) { flash('Debe ser una lista [ … ].', 6000); return; }
    data.forEach(function (r) {
      var id = r && String(r.id || ''), q = Math.round(+(r && r.qty));
      if (!id || !parse(id) || !(q > 0)) { bad++; return; }
      change(id, String(r.place || '').trim().slice(0, 40), Math.min(q, 99999)); n++;
    });
    save(); render();
    flash(n + ' líneas agregadas' + (bad ? ' · ' + bad + ' no reconocidas' : '') + '.', 8000);
  });
  $('#sk-copy').addEventListener('click', function () {
    var out = [];
    Object.keys(stock).forEach(function (id) {
      var m = loc[id] || {}, un = unassigned(id);
      Object.keys(m).forEach(function (k) { out.push({ id: id, place: k, qty: m[k] }); });
      if (un > 0) out.push({ id: id, place: '', qty: un });
    });
    var txt = JSON.stringify(out, null, 1), ta = $('#sk-json');
    ta.value = txt;
    var manual = function () { ta.focus(); ta.select(); flash('Texto seleccionado: usa Ctrl+C.'); };
    try { navigator.clipboard.writeText(txt).then(function () { flash('Stock copiado.'); }, manual); } catch (e) { manual(); }
  });

  /* ---------- Selector para agregar ---------- */
  var pk = null;
  var last = { tier: 8, ench: 0, slot: 'weapon', special: 'mount', place: '' };
  function slotsFor(tab) { return tab === 'special' ? SPECIAL : SLOTS; }
  function pkCandidates() {
    var q = plain(pk.q.trim()), out = [];
    if (view.tab !== 'mats') {
      DEFS.forEach(function (d) {
        if (d.slot !== pk.slot) return;
        for (var t = 1; t <= 8; t++) {
          if (((d.tiers >> t) & 1) !== 1 || (pk.tier && pk.tier !== t)) continue;
          for (var e = 0; e <= 4; e++) {
            if (!(e === 0 || ((d.ench >> (e - 1)) & 1) === 1) || (pk.ench >= 0 && pk.ench !== e)) continue;
            var nm = pickName(d.name, t);
            if (q && plain(nm).indexOf(q) < 0 && plain(pickName(d.nameEn, t)).indexOf(q) < 0) continue;
            out.push({ id: 'T' + t + '_' + d.key + (e ? '@' + e : ''), name: nm, tier: t, ench: e, two: d.two });
          }
        }
      });
      return out.sort(function (a, b) { return a.name.localeCompare(b.name) || b.tier - a.tier || a.ench - b.ench; }).slice(0, 150);
    }
    return MATS.filter(function (m) {
      return (pk.tier === 0 || m.tier === pk.tier) && (pk.ench < 0 || m.ench === pk.ench) && (!q || plain(m.name).indexOf(q) >= 0);
    }).sort(function (a, b) { return a.name.localeCompare(b.name); }).slice(0, 120);
  }
  function pkChips() {
    var isDef = view.tab !== 'mats', t, h = '<span class="lab">Tier</span>', union = 0;
    if (isDef) {
      DEFS.forEach(function (d) { if (d.slot === pk.slot) union |= d.tiers; });
      $('#pk-slots').hidden = false;
      $('#pk-slots').innerHTML = '<span class="lab">Tipo</span>' + slotsFor(view.tab).map(function (s) { return '<button type="button" class="chip" data-slot="' + s.id + '" aria-pressed="' + (pk.slot === s.id) + '">' + s.label + '</button>'; }).join('');
    } else $('#pk-slots').hidden = true;
    h += '<button type="button" class="chip" data-tier="0" aria-pressed="' + (pk.tier === 0) + '">Todos</button>';
    for (t = 1; t <= 8; t++) h += '<button type="button" class="chip" data-tier="' + t + '" aria-pressed="' + (pk.tier === t) + '"' + (isDef && !((union >> t) & 1) ? ' disabled' : '') + '>T' + t + '</button>';
    $('#pk-tiers').innerHTML = h;
    var e, h2 = '<span class="lab">Encant.</span><button type="button" class="chip" data-ench="-1" aria-pressed="' + (pk.ench === -1) + '">Todos</button>';
    for (e = 0; e <= 4; e++) h2 += '<button type="button" class="chip" data-ench="' + e + '" aria-pressed="' + (pk.ench === e) + '">.' + e + '</button>';
    $('#pk-ench').innerHTML = h2;
  }
  function pkList() {
    var list = pkCandidates(), host = $('#pk-list');
    host.innerHTML = list.length ? list.map(function (c) {
      return '<li><button type="button" class="pk-item" data-id="' + esc(c.id) + '">' + iconHtml(c.id, c.name) + '<span class="pk-txt"><span class="pk-name">' + esc(c.name) + (c.two ? ' <span class="two">2H</span>' : '') +
        '</span><span class="pk-key">' + tagText(c.tier, c.ench) + ' · en stock: ' + fmt.format(stock[c.id] || 0) + '</span></span></button></li>';
    }).join('') : '<li class="pk-none">No hay resultados. Prueba otro tier, encantamiento o búsqueda.</li>';
    wireIcons(host);
  }
  function openPicker() {
    var isItems = view.tab === 'items';
    pk = { q: '', slot: view.tab === 'special' ? last.special : last.slot, tier: isItems ? last.tier : 0, ench: isItems ? last.ench : -1 };
    $('#pk-title').textContent = isItems ? 'Agregar item al stock' : view.tab === 'special' ? 'Agregar especial al stock' : 'Agregar material al stock';
    $('#pk-q').value = ''; $('#pk-place').value = last.place; $('#pk-qty').value = 1;
    $('#pk-note').textContent = 'Toca un item para sumarlo al stock en ese lugar.';
    pkChips(); pkList();
    $('#picker').hidden = false; document.documentElement.classList.add('lock'); $('#pk-q').focus();
  }
  function closePicker() { $('#picker').hidden = true; document.documentElement.classList.remove('lock'); pk = null; $('#sk-add').focus(); }
  $('#sk-add').addEventListener('click', openPicker);
  $('#picker').addEventListener('click', function (ev) {
    if (!pk) return;
    if (ev.target.id === 'picker' || ev.target.closest('[data-pk="close"]')) { closePicker(); return; }
    var sl = ev.target.closest('[data-slot]'), t = ev.target.closest('[data-tier]'), en = ev.target.closest('[data-ench]'), it = ev.target.closest('[data-id]');
    if (sl) { pk.slot = sl.dataset.slot; if (view.tab === 'special') last.special = pk.slot; else last.slot = pk.slot; pkChips(); pkList(); }
    else if (t && !t.disabled) { pk.tier = +t.dataset.tier; if (view.tab === 'items') last.tier = pk.tier; pkChips(); pkList(); }
    else if (en) { pk.ench = +en.dataset.ench; if (view.tab === 'items') last.ench = pk.ench; pkChips(); pkList(); }
    else if (it) {
      var place = $('#pk-place').value.trim().slice(0, 40), n = clamp(parseInt($('#pk-qty').value, 10) || 1, 1, 99999), e = parse(it.dataset.id);
      last.place = place;
      change(it.dataset.id, place, n); save(); render();
      $('#pk-note').textContent = 'Agregado: ' + n + '× ' + e.name + ' ' + tagText(e.tier, e.ench) + ' en ' + (place || 'sin lugar') + ' · total ' + fmt.format(stock[it.dataset.id]) + '.';
      pkList();
    }
  });
  $('#pk-q').addEventListener('input', function (ev) { if (pk) { pk.q = ev.target.value; pkList(); } });
  document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && pk) closePicker(); });

  // Si el stock cambia desde la página de builds, se recarga aquí.
  function resync() { setTimeout(function () { load(); render(); }, 0); }
  window.addEventListener('storage', function (ev) { if (ev.key === LS) resync(); });
  window.addEventListener('regear:remote', resync);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) resync(); });

  /* Tema */
  var themeBtn = $('#theme');
  function currentTheme() {
    var a = document.documentElement.getAttribute('data-theme');
    return a || (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  }
  function themeLabel() { themeBtn.textContent = currentTheme() === 'dark' ? 'Modo claro' : 'Modo oscuro'; }
  var savedTheme = lsGet(LS_THEME);
  if (savedTheme === 'dark' || savedTheme === 'light') document.documentElement.setAttribute('data-theme', savedTheme);
  themeBtn.addEventListener('click', function () {
    var next = currentTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next); lsSet(LS_THEME, next); themeLabel();
  });
  themeLabel();

  load(); render();
  $('#lg-out').innerHTML = histHtml();
})();
