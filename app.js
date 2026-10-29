(function () {
  'use strict';

  var DB = window.ALBION_DB;
  // Recetas: R[key][ench] = [[recurso, cantidad por unidad]], con T# = tier y @# = encantamiento; "tier.ench" son excepciones. N = nombres.
  var REC = window.ALBION_REC;
  var CITIES = ['Caerleon', 'Bridgewatch', 'Fort Sterling', 'Lymhurst', 'Martlock', 'Thetford', 'Brecilien'];
  var SERVERS = { west: 'Américas (west)', east: 'Asia (east)', europe: 'Europa (europe)' };

  var SLOTS = [
    { id: 'weapon', label: 'Arma' }, { id: 'offhand', label: 'Mano secundaria' },
    { id: 'head', label: 'Cabeza' }, { id: 'armor', label: 'Armadura' }, { id: 'shoes', label: 'Botas' },
    { id: 'cape', label: 'Capa' }
  ];
  var SLOT_LABEL = {};
  SLOTS.forEach(function (s) { SLOT_LABEL[s.id] = s.label; });

  // Las builds se muestran agrupadas en este orden.
  var ROLES = [{ id: 'dps', label: 'DPS' }, { id: 'healer', label: 'Healer' }, { id: 'tank', label: 'Tank' }, { id: 'support', label: 'Support' }];
  var ROLE_IDS = ROLES.map(function (r) { return r.id; });
  function roleOptions(sel) {
    return ROLES.map(function (r) { return '<option value="' + r.id + '"' + (r.id === sel ? ' selected' : '') + '>' + r.label + '</option>'; }).join('');
  }

  // r = [key, slot, tierMask, enchMask (bit e-1 = encantamiento e), nombreEN, twoHanded, nombreES]; los nombres son texto o {tier: texto}
  var DEFS = DB.map(function (r) { return { key: r[0], slot: r[1], tiers: r[2], ench: r[3], nameEn: r[4], name: r[6] || r[4], two: r[5] === 1 }; });
  var byKey = new Map(DEFS.map(function (d) { return [d.key, d]; }));

  var LS = 'regear-albion-v1';
  var LS_THEME = 'regear-albion-theme';

  function $(sel) { return document.querySelector(sel); }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }
  function uid() { return Math.random().toString(36).slice(2, 9); }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* sin almacenamiento: la página sigue funcionando */ } }

  function hasTier(def, t) { return ((def.tiers >> t) & 1) === 1; }
  function hasEnch(def, e) { return e === 0 || ((def.ench >> (e - 1)) & 1) === 1; }
  function pickName(n, tier) {
    if (typeof n === 'string') return n;
    return n[String(tier)] || n[Object.keys(n)[0]];
  }
  function nameOf(def, tier) { return pickName(def.name, tier); }
  function plain(s) { return String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }
  function itemId(key, tier, ench) { return 'T' + tier + '_' + key + (ench ? '@' + ench : ''); }
  function tagText(tier, ench) { return 'T' + tier + (ench ? '.' + ench : ''); }
  function tagHtml(tier, ench) {
    return '<span class="tag t' + tier + '"><span>T' + tier + '</span>' +
      (ench ? '<span class="e e' + ench + '">.' + ench + '</span>' : '') + '</span>';
  }
  function isTwoHanded(b) { return !!(b.slots.weapon && byKey.get(b.slots.weapon.key).two); }

  /* ---------- Estado ---------- */
  // Datos de la muerte de cada jugador (para «Ver quién lo mató»); se valida la forma al cargar.
  function cleanKill(k) {
    if (!k || typeof k !== 'object' || !k.killer || !k.victim) return null;
    function side(p) {
      var eq = {};
      Object.keys(p.eq || {}).slice(0, 12).forEach(function (key) {
        var it = p.eq[key];
        if (it && typeof it.Type === 'string' && /^[A-Za-z0-9_@]{1,80}$/.test(it.Type)) eq[key.slice(0, 12)] = { Type: it.Type, Count: 1 };
      });
      return { name: String(p.name || '?').slice(0, 40), guild: String(p.guild || '').slice(0, 60), alliance: String(p.alliance || '').slice(0, 20), ip: Math.max(0, Math.round(+p.ip || 0)), eq: eq };
    }
    return {
      time: +k.time || 0, fame: Math.max(0, Math.round(+k.fame || 0)), killer: side(k.killer), victim: side(k.victim),
      inv: (Array.isArray(k.inv) ? k.inv : []).filter(function (i) { return i && typeof i.Type === 'string' && /^[A-Za-z0-9_@]{1,80}$/.test(i.Type); })
        .slice(0, 40).map(function (i) { return { Type: i.Type, Count: clamp(Math.round(+i.Count) || 1, 1, 99999) }; })
    };
  }
  function cleanBuild(b) {
    var nb = { id: uid(), name: String((b && b.name) || 'Build').slice(0, 60), players: clamp(parseInt(b && b.players, 10) || 1, 1, 99), role: (b && ROLE_IDS.indexOf(b.role) >= 0) ? b.role : 'dps', slots: {} };
    SLOTS.forEach(function (s) {
      var it = b && b.slots && b.slots[s.id];
      if (!it || !byKey.has(it.key)) return;
      var def = byKey.get(it.key), t = +it.tier, e = +it.ench || 0;
      if (def.slot !== s.id || !(t >= 1 && t <= 8) || !hasTier(def, t) || e < 0 || e > 4 || !hasEnch(def, e)) return;
      nb.slots[s.id] = { key: it.key, tier: t, ench: e, qty: clamp(parseInt(it.qty, 10) || 1, 1, 99) };
    });
    if (isTwoHanded(nb)) delete nb.slots.offhand;
    if (b && b.deny && typeof b.deny === 'object') {
      Object.keys(b.deny).slice(0, 99).forEach(function (j) {
        var v = Array.isArray(b.deny[j]) ? b.deny[j].filter(function (x, i, a) { return (x === 'all' || SLOT_LABEL[x]) && a.indexOf(x) === i; }) : [];
        if (/^\d{1,2}$/.test(j) && v.length) { nb.deny = nb.deny || {}; nb.deny[j] = v.indexOf('all') >= 0 ? ['all'] : v; }
      });
    }
    if (b && b.kills && typeof b.kills === 'object') {
      Object.keys(b.kills).slice(0, 99).forEach(function (j) {
        var kk = /^\d{1,2}$/.test(j) ? cleanKill(b.kills[j]) : null;
        if (kk) { nb.kills = nb.kills || {}; nb.kills[j] = kk; }
      });
    }
    if (b && Array.isArray(b.members)) nb.members = b.members.filter(function (n) { return typeof n === 'string' && n; }).map(function (n) { return n.slice(0, 40); }).slice(0, 99);
    return nb;
  }
  function sanitize(s) {
    var out = { builds: [], guides: [], checked: {}, taken: {}, stock: {}, stockLoc: {}, prices: {}, prefs: { tier: 8, ench: 0, server: 'west', city: 'Caerleon', role: 'dps', guild: '', mode: 'builds' } };
    if (s && Array.isArray(s.builds)) s.builds.slice(0, 60).forEach(function (b) { out.builds.push(cleanBuild(b)); });
    if (s && Array.isArray(s.guides)) s.guides.slice(0, 60).forEach(function (b) { var g = cleanBuild(b); delete g.members; out.guides.push(g); });
    if (s && s.checked && typeof s.checked === 'object') Object.keys(s.checked).forEach(function (k) { if (s.checked[k]) out.checked[k] = true; });
    ['stock', 'taken'].forEach(function (f) {
      if (!s || !s[f] || typeof s[f] !== 'object') return;
      Object.keys(s[f]).slice(0, 4000).forEach(function (id) {
        var v = Math.round(+s[f][id]);
        if (/^T\d_[A-Za-z0-9_]+(@\d)?$/.test(id) && isFinite(v) && v > 0) out[f][id] = Math.min(v, 99999);
      });
    });
    if (s && s.stockLoc && typeof s.stockLoc === 'object') {
      Object.keys(out.stock).forEach(function (id) {
        var l = s.stockLoc[id];
        if (!l || typeof l !== 'object') return;
        var clean = {}, sum = 0;
        Object.keys(l).slice(0, 40).forEach(function (k) {
          var v = Math.min(Math.round(+l[k]), out.stock[id] - sum);
          if (k && k.length <= 40 && v > 0) { clean[k] = v; sum += v; }
        });
        if (sum) out.stockLoc[id] = clean;
      });
    }
    if (s && s.prefs) {
      var t = +s.prefs.tier, e = +s.prefs.ench;
      if (t >= 1 && t <= 8) out.prefs.tier = t;
      if (e >= 0 && e <= 4) out.prefs.ench = e;
      if (SERVERS[s.prefs.server]) out.prefs.server = s.prefs.server;
      if (CITIES.indexOf(s.prefs.city) >= 0) out.prefs.city = s.prefs.city;
      if (ROLE_IDS.indexOf(s.prefs.role) >= 0) out.prefs.role = s.prefs.role;
      if (typeof s.prefs.guild === 'string') out.prefs.guild = s.prefs.guild.slice(0, 80);
      if (s.prefs.mode === 'guides' || s.prefs.mode === 'players' || s.prefs.mode === 'killboard') out.prefs.mode = s.prefs.mode;
      var kg = s.prefs.kbGuild;
      if (kg && typeof kg.id === 'string' && /^[A-Za-z0-9_-]{6,40}$/.test(kg.id)) out.prefs.kbGuild = { id: kg.id, name: String(kg.name || '').slice(0, 60), alliance: String(kg.alliance || '').slice(0, 20) };
    }
    if (s && s.prices && typeof s.prices === 'object') {
      Object.keys(s.prices).slice(0, 4000).forEach(function (id) {
        var v = Math.round(+s.prices[id]);
        if (/^T\d_[A-Za-z0-9_]+(@\d)?$/.test(id) && isFinite(v) && v > 0) out.prices[id] = v;
      });
    }
    return out;
  }
  function examples() {
    function sp(a) { return { key: a[0], tier: a[1], ench: a[2], qty: a[3] || 1 }; }
    return [
      cleanBuild({ name: 'Ejemplo · Fire Staff', role: 'dps', players: 3, slots: {
        weapon: sp(['MAIN_FIRESTAFF', 8, 1]), offhand: sp(['OFF_BOOK', 8, 1]), head: sp(['HEAD_CLOTH_SET1', 8, 1]),
        armor: sp(['ARMOR_CLOTH_SET1', 8, 1]), shoes: sp(['SHOES_CLOTH_SET1', 8, 1]), cape: sp(['CAPEITEM_FW_BRIDGEWATCH', 8, 0])
      } }),
      cleanBuild({ name: 'Ejemplo · Mace + Shield', role: 'tank', players: 2, slots: {
        weapon: sp(['MAIN_MACE', 8, 2]), offhand: sp(['OFF_SHIELD', 8, 2]), head: sp(['HEAD_PLATE_SET1', 8, 2]),
        armor: sp(['ARMOR_PLATE_SET1', 8, 2]), shoes: sp(['SHOES_PLATE_SET1', 8, 2]), cape: sp(['CAPEITEM_FW_BRIDGEWATCH', 8, 0])
      } })
    ];
  }
  function loadState() {
    var raw = lsGet(LS);
    if (raw) { try { return sanitize(JSON.parse(raw)); } catch (e) { /* datos corruptos: se parte de cero */ } }
    return { builds: examples(), guides: [], checked: {}, taken: {}, stock: {}, stockLoc: {}, prices: {}, prefs: { tier: 8, ench: 0, server: 'west', city: 'Caerleon', role: 'dps', guild: '', mode: 'builds' } };
  }
  var state = loadState();
  // Se conservan los campos que solo usa la página de stock (movimientos, registro del banco).
  function save() {
    var cur = {};
    try { cur = JSON.parse(lsGet(LS) || '{}') || {}; } catch (e) { cur = {}; }
    var txt = JSON.stringify(Object.assign(cur, state));
    lsSet(LS, txt); lastSeen = txt;
  }
  function getBuild(id) { return state.builds.concat(state.guides).filter(function (b) { return b.id === id; })[0]; }
  function isGuide(b) { return state.guides.indexOf(b) >= 0; }
  function listOf(b) { return isGuide(b) ? state.guides : state.builds; }
  function curList() { return state.prefs.mode === 'guides' ? state.guides : state.builds; }

  /* ---------- Reequips denegados (por jugador) ---------- */
  // b.deny[j] = ['all'] o lista de slots que no se reequipan al jugador j de la build.
  function isDenied(b, j, slot) {
    var d = b.deny && b.deny[j];
    return !!d && (d.indexOf('all') >= 0 || d.indexOf(slot) >= 0);
  }
  function activeCount(b, slot) {
    var n = 0;
    for (var j = 0; j < b.players; j++) if (!isDenied(b, j, slot)) n++;
    return n;
  }
  function activeNames(b, slot) {
    return (b.members || []).filter(function (n, j) { return j < b.players && !isDenied(b, j, slot); });
  }
  function itemSlots(b) {
    var two = isTwoHanded(b);
    return SLOTS.filter(function (sl) { return b.slots[sl.id] && !(sl.id === 'offhand' && two); }).map(function (sl) { return sl.id; });
  }
  function deniedUnits() {
    var n = 0;
    state.builds.forEach(function (b) {
      itemSlots(b).forEach(function (sl) { n += (b.players - activeCount(b, sl)) * b.slots[sl].qty; });
    });
    return n;
  }
  function toggleSlot(b, j, slot) {
    var cur = b.deny && b.deny[j] || [], all = itemSlots(b);
    var set = cur.indexOf('all') >= 0 ? all.slice() : cur.slice(), i = set.indexOf(slot);
    if (i >= 0) set.splice(i, 1); else set.push(slot);
    setDeny(b, j, set.length >= all.length ? ['all'] : set);
  }
  function setDeny(b, j, list) {
    if (list && list.length) { b.deny = b.deny || {}; b.deny[j] = list; }
    else if (b.deny) { delete b.deny[j]; if (!Object.keys(b.deny).length) delete b.deny; }
  }

  /* ---------- Builds guía: tier mínimo por slot ---------- */
  // Se compara por arma; si hay varias guías con la misma arma, gana la del mismo rol. Cumple si tier + encantamiento >= la guía.
  function guideFor(slots, role) {
    var k = slots.weapon ? slots.weapon.key : '';
    if (!k) return null;
    var c = state.guides.filter(function (g) { return g.slots.weapon && g.slots.weapon.key === k; });
    return c.filter(function (g) { return g.role === role; })[0] || c[0] || null;
  }
  function deficits(slots, g) {
    var out = {};
    if (!g) return out;
    SLOTS.forEach(function (sl) {
      var gi = g.slots[sl.id], pi = slots[sl.id];
      if (gi && pi && pi.tier + pi.ench < gi.tier + gi.ench) out[sl.id] = { have: pi, need: gi };
    });
    return out;
  }
  // Si el jugador llevaba el mismo item pero de más nivel (tier + enc.) que la guía, se reequipa con el de la guía.
  function regearItem(it, g, slotId) {
    var gi = g && g.slots[slotId];
    if (gi && it && gi.key === it.key && it.tier + it.ench > gi.tier + gi.ench) return { it: Object.assign({}, it, { tier: gi.tier, ench: gi.ench }), over: it };
    return { it: it, over: null };
  }
  function buildCheck(b) {
    var g = isGuide(b) ? null : guideFor(b.slots, b.role);
    return { guide: g, def: deficits(b.slots, g) };
  }

  /* ---------- Totales ---------- */
  function perPlayer(b) {
    var n = 0, two = isTwoHanded(b);
    SLOTS.forEach(function (s) { var it = b.slots[s.id]; if (it && !(s.id === 'offhand' && two)) n += it.qty; });
    return n;
  }
  function totals() {
    var map = new Map();
    state.builds.forEach(function (b) {
      var two = isTwoHanded(b), chk = buildCheck(b);
      SLOTS.forEach(function (s) {
        var it0 = b.slots[s.id];
        if (!it0 || (s.id === 'offhand' && two)) return;
        var act = activeCount(b, s.id);
        if (!act) return;
        var rg = regearItem(it0, chk.guide, s.id), it = rg.it;
        var id = itemId(it.key, it.tier, it.ench), add = act * it.qty, cur = map.get(id);
        if (cur) cur.count += add;
        else { cur = { id: id, key: it.key, tier: it.tier, ench: it.ench, slot: s.id, count: add, below: [], capped: [] }; map.set(id, cur); }
        if (rg.over) cur.capped.push({ names: activeNames(b, s.id), had: rg.over, guide: chk.guide.name });
        var d = chk.def[s.id];
        var nm = activeNames(b, s.id);
        if (d && nm.length) cur.below.push({ names: nm, have: it, need: d.need, guide: chk.guide.name });
      });
    });
    var merged = mergeEquivalents(map);
    coverStock(merged);
    return merged;
  }
  // Une en una sola fila los items equivalentes (mismo item, igual tier + encantamiento): se contabilizan juntos.
  // La fila lleva el de mayor tier y guarda el desglose en parts para calcular materiales.
  function mergeEquivalents(map) {
    var groups = {}, order = [], out = new Map();
    map.forEach(function (r) {
      var g = r.key + '|' + (r.tier + r.ench);
      if (!groups[g]) { groups[g] = []; order.push(g); }
      groups[g].push(r);
    });
    order.forEach(function (g) {
      var rows = groups[g].sort(function (a, b) { return b.tier - a.tier || a.ench - b.ench; }), rep = Object.assign({}, rows[0]);
      rep.parts = rows.map(function (r) { return { tier: r.tier, ench: r.ench, count: r.count }; });
      rep.count = rows.reduce(function (a, r) { return a + r.count; }, 0);
      rep.below = rows.reduce(function (a, r) { return a.concat(r.below); }, []);
      rep.capped = rows.reduce(function (a, r) { return a.concat(r.capped || []); }, []);
      out.set(rep.id, rep);
    });
    return out;
  }
  // Equivalencia: el mismo item con igual tier + encantamiento (6.3 = 7.2 = 8.1) comparte un solo stock.
  function idParts(id) {
    var m = /^T(\d)_(.+?)(?:@(\d))?$/.exec(id);
    return m ? { key: m[2], tier: +m[1], ench: +(m[3] || 0) } : null;
  }
  function groupIds(key, level, extra) {
    var ids = Object.keys(state.stock).filter(function (i) { var p = idParts(i); return p && p.key === key && p.tier + p.ench === level; });
    if (extra && ids.indexOf(extra) < 0) ids.push(extra);
    return ids;
  }
  // Reparte el stock equivalente entre las filas del mismo grupo: primero el item exacto y luego los equivalentes.
  function coverStock(map) {
    var groups = {};
    map.forEach(function (r) { (groups[r.key + '|' + (r.tier + r.ench)] = groups[r.key + '|' + (r.tier + r.ench)] || []).push(r); });
    Object.keys(groups).forEach(function (g) {
      var rows = groups[g], pool = groupIds(rows[0].key, rows[0].tier + rows[0].ench).reduce(function (a, i) { return a + stockOf(i); }, 0);
      rows.forEach(function (r) {
        r.need = Math.max(0, r.count - takenOf(r.id));
        r.cov = Math.min(r.need, stockOf(r.id)); pool -= r.cov;
      });
      rows.forEach(function (r) { var extra = Math.min(r.need - r.cov, Math.max(0, pool)); r.cov += extra; pool -= extra; r.miss = r.need - r.cov; });
      // El stock cubre primero las partes de mayor tier; lo que falta se reparte en el resto.
      rows.forEach(function (r) {
        var left = r.cov + Math.min(takenOf(r.id), r.count);
        r.parts.forEach(function (pt) { var c = Math.min(pt.count, left); left -= c; pt.miss = pt.count - c; });
      });
    });
  }
  // Quita n unidades del grupo: primero el item exacto y luego los equivalentes (de mayor a menor tier).
  function consume(r, n) {
    var ids = groupIds(r.key, r.tier + r.ench, r.id).sort(function (a, b) { return (a === r.id ? -1 : b === r.id ? 1 : idParts(b).tier - idParts(a).tier); });
    ids.forEach(function (i) { if (n <= 0) return; var d = Math.min(n, stockOf(i)); if (d > 0) { setStock(i, stockOf(i) - d); n -= d; } });
  }
  function poolOf(r) { return groupIds(r.key, r.tier + r.ench, r.id).reduce(function (a, i) { return a + stockOf(i); }, 0); }
  function setPool(r, n) {
    n = clamp(Math.round(+n) || 0, 0, 99999);
    var cur = poolOf(r);
    if (n > cur) setStock(r.id, stockOf(r.id) + n - cur); else if (n < cur) consume(r, cur - n);
  }

  /* ---------- Stock ---------- */
  function stockOf(id) { return state.stock[id] || 0; }
  function takenOf(id) { return state.taken[id] || 0; }
  // Lo que falta = necesario - stock disponible - lo ya sacado del cofre (que se descontó del stock al marcarlo).
  function missingOf(r) { return r.miss; }
  // state.stockLoc[id] = {lugar: cantidad} es el desglose por lugar; lo que no está repartido es «sin lugar».
  // Al bajar el total se quita primero de «sin lugar» y luego de los lugares en orden.
  function setStock(id, n) {
    n = clamp(Math.round(+n) || 0, 0, 99999);
    var loc = state.stockLoc[id];
    if (loc) {
      var sum = Object.keys(loc).reduce(function (a, k) { return a + loc[k]; }, 0), over = sum - n;
      Object.keys(loc).forEach(function (k) {
        if (over <= 0) return;
        var cut = Math.min(loc[k], over); loc[k] -= cut; over -= cut;
        if (loc[k] <= 0) delete loc[k];
      });
      if (!Object.keys(loc).length) delete state.stockLoc[id];
    }
    if (n > 0) state.stock[id] = n; else { delete state.stock[id]; delete state.stockLoc[id]; }
  }
  // Devuelve al stock lo que se había marcado como sacado.
  function releaseTaken() {
    Object.keys(state.taken).forEach(function (id) { setStock(id, stockOf(id) + state.taken[id]); });
    state.taken = {}; state.checked = {};
  }
  function stockCtl(id, name, n, note) {
    if (n == null) n = stockOf(id);
    return '<span class="stk"><span class="stk-lab">Stock</span><button type="button" class="step sm" data-st="dec" data-id="' + esc(id) + '" aria-label="Quitar uno de ' + esc(name) + '">−</button>' +
      '<input class="st-in" type="number" inputmode="numeric" min="0" max="99999" value="' + n + '" data-id="' + esc(id) + '" aria-label="Stock de ' + esc(name) + '">' +
      '<button type="button" class="step sm" data-st="inc" data-id="' + esc(id) + '" aria-label="Agregar uno de ' + esc(name) + '">+</button>' + (note ? '<span class="eq" title="Mismo item con igual tier + encantamiento">' + esc(note) + '</span>' : '') + '</span>';
  }

  /* ---------- Iconos (render.albiononline.com) ---------- */
  function iconHtml(id, label, small) {
    return '<span class="ic' + (small ? ' sm' : '') + '" aria-hidden="true"><span class="ph">' + esc(label.charAt(0)) + '</span>' +
      '<img src="https://render.albiononline.com/v1/item/' + esc(id) + '.png?size=64" alt="" loading="lazy" decoding="async"></span>';
  }
  function wireIcons(root) {
    root.querySelectorAll('.ic img').forEach(function (img) {
      if (img.dataset.wired) return;
      img.dataset.wired = '1';
      function ok() { if (img.naturalWidth > 0) img.parentNode.classList.add('ok'); else fail(); }
      function fail() { if (img.parentNode) img.remove(); }
      if (img.complete) ok();
      else { img.addEventListener('load', ok); img.addEventListener('error', fail); }
    });
  }

  /* ---------- Builds ---------- */
  function slotHtml(b, s) {
    var it = b.slots[s.id], two = isTwoHanded(b), ref = 'data-build="' + b.id + '" data-slot="' + s.id + '"';
    if (s.id === 'offhand' && two) {
      return '<div class="slot off"><div class="slot-main"><span class="s-label">' + s.label + '</span><span class="s-note">Ocupada por el arma a dos manos</span></div></div>';
    }
    if (!it) {
      return '<div class="slot"><button type="button" class="slot-main" data-action="pick" ' + ref + '><span class="s-label">' + s.label +
        '</span><span class="s-empty">+ Elegir item</span></button></div>';
    }
    var def = byKey.get(it.key), nm = nameOf(def, it.tier), dfc = isGuide(b) ? null : buildCheck(b).def[s.id];
    return '<div class="slot' + (dfc ? ' under' : '') + '"><button type="button" class="slot-main" data-action="pick" ' + ref + '><span class="s-label">' + s.label + '</span>' +
      '<span class="s-body">' + iconHtml(itemId(it.key, it.tier, it.ench), nm) + '<span class="s-txt"><span class="s-name">' + esc(nm) + '</span>' +
      tagHtml(it.tier, it.ench) + (def.two ? '<span class="two">2H</span>' : '') + (dfc ? '<span class="under-tag" title="La guía pide ' + tagText(dfc.need.tier, dfc.need.ench) + '">bajo guía ' + tagText(dfc.need.tier, dfc.need.ench) + '</span>' : '') + '</span></span></button>' +
      '<div class="s-ex"><label class="qty">×<input class="qty-in" type="number" inputmode="numeric" min="1" max="99" value="' + it.qty + '" ' + ref +
      ' aria-label="Cantidad de ' + esc(s.label.toLowerCase()) + ' por jugador"></label>' +
      '<button type="button" class="x" data-action="clear" ' + ref + ' aria-label="Quitar ' + esc(s.label.toLowerCase()) + '">×</button></div></div>';
  }
  var armedDelete = null;
  function memberLine(b) {
    if (isGuide(b)) return '';
    var chk = buildCheck(b), under = Object.keys(chk.def).length > 0, g = chk.guide;
    var note = g ? 'Guía: <b>' + esc(g.name) + '</b>' : (state.guides.length ? 'Sin guía para esta arma' : '');
    var dn = Object.keys(b.deny || {}).filter(function (j) { return +j < b.players; }).length;
    if (dn) note += (note ? ' · ' : '') + '<span class="mem bad">⛔ ' + dn + (dn === 1 ? ' jugador con reequip denegado' : ' jugadores con reequip denegado') + '</span>';
    var names = b.members && b.members.length ? '<span class="mem' + (under ? ' bad' : '') + '">' + (under ? '⚠ Bajo la guía: ' : 'Jugadores: ') + esc(b.members.join(', ')) + '</span>' : '';
    return note || names ? '<div class="b-members">' + (note ? '<span>' + note + '</span>' : '') + names + '</div>' : '';
  }
  function playerEntries() {
    var out = [], q = plain(($('#pl-q').value || '').trim());
    state.builds.forEach(function (b) {
      var rk = b.slots.weapon ? (b.slots.weapon.tier + b.slots.weapon.ench) * 10 + b.slots.weapon.tier : 0;
      for (var j = 0; j < b.players; j++) {
        var name = b.members && b.members[j] || 'Jugador ' + (j + 1) + ' · ' + b.name;
        if (q && plain(name + ' ' + b.name).indexOf(q) < 0) continue;
        out.push({ b: b, j: j, name: name, rk: rk, anon: !(b.members && b.members[j]) });
      }
    });
    return out.sort(function (a, c) { return c.rk - a.rk || a.name.localeCompare(c.name); });
  }
  function playerHtml(e) {
    var b = e.b, j = e.j, slots = itemSlots(b), den = slots.filter(function (sl) { return isDenied(b, j, sl); }), all = slots.length && den.length === slots.length;
    var ref = 'data-build="' + b.id + '" data-j="' + j + '"', kl = b.kills && b.kills[j];
    var status = all ? '<span class="pl-st bad">Reequip denegado</span>' : den.length ? '<span class="pl-st warn">Parcial: sin ' + esc(den.map(function (k) { return SLOT_LABEL[k].toLowerCase(); }).join(', ')) + '</span>' : '<span class="pl-st ok">Reequip completo</span>';
    var chips = slots.map(function (sl) {
      var it0 = b.slots[sl], rg = regearItem(it0, guideFor(b.slots, b.role), sl), it = rg.it, d = isDenied(b, j, sl), nm = nameOf(byKey.get(it.key), it.tier);
      return '<button type="button" class="pl-chip-s' + (d ? ' off' : '') + '" data-action="p-slot" ' + ref + ' data-slot="' + sl + '" aria-pressed="' + d + '" title="' + (d ? 'Permitir' : 'Denegar') + ' ' + esc(SLOT_LABEL[sl].toLowerCase()) + '">' +
        '<span class="pcs-l">' + SLOT_LABEL[sl] + '</span><span class="pcs-n">' + esc(nm) + ' ' + tagHtml(it.tier, it.ench) + (rg.over ? ' <span class="cap-note">(llevaba ' + tagText(rg.over.tier, rg.over.ench) + ')</span>' : '') + '</span>' + (d ? '<span class="pcs-x">Denegado</span>' : '') + '</button>';
    }).join('');
    return '<article class="pl-card role-' + b.role + (all ? ' denied' : '') + '"><header class="pl-h"><div class="pl-who"><span class="role-dot" aria-hidden="true"></span><b class="pl-n">' + esc(e.name) + '</b>' +
      '<span class="pl-b">' + esc(b.name) + '</span>' + (kl ? '<span class="pl-k">☠ Lo mató ' + esc(kl.killer.name) + '</span>' : '') + '</div>' + status +
      (kl ? '<button type="button" class="btn sm" data-action="p-kill" ' + ref + ' title="Ver el equipo del asesino y de la víctima">☠ Muerte</button>' : '') +
      '<button type="button" class="btn sm' + (all ? '' : ' danger') + '" data-action="p-all" ' + ref + '>' + (all ? 'Permitir todo' : 'Denegar todo') + '</button></header>' +
      '<div class="pl-chips">' + (chips || '<span class="hint">Esta build no tiene items.</span>') + '</div></article>';
  }
  function renderPlayers(host) {
    var list = playerEntries(), total = 0, denied = 0;
    state.builds.forEach(function (b) { total += b.players; denied += Object.keys(b.deny || {}).filter(function (j) { return +j < b.players; }).length; });
    $('#pl-sum').textContent = total + (total === 1 ? ' jugador' : ' jugadores') + ' · ' + denied + ' con reequip denegado (' + deniedUnits() + ' items sin sacar)';
    host.innerHTML = list.length ? '<div class="pl-list">' + list.map(playerHtml).join('') + '</div>'
      : '<p class="empty">' + (total ? 'Ningún jugador coincide con la búsqueda.' : 'No hay jugadores. Importa una pelea o crea builds en «Builds de regear».') + '</p>';
  }
  function buildHtml(b) {
    var pp = perPlayer(b), guide = isGuide(b);
    return '<article class="build' + (guide ? ' guide' : '') + '" data-id="' + b.id + '"><header class="b-head">' +
      '<input class="b-name" id="name-' + b.id + '" value="' + esc(b.name) + '" maxlength="60" aria-label="Nombre de la build" data-build="' + b.id + '">' +
      '<select class="sel b-role" id="role-' + b.id + '" data-build="' + b.id + '" aria-label="Rol de la build">' + roleOptions(b.role) + '</select>' +
      (guide ? '' : '<div class="players"><button type="button" class="step" data-action="dec" data-build="' + b.id + '" aria-label="Menos jugadores">−</button>' +
      '<input class="pl-num" type="number" inputmode="numeric" min="1" max="99" value="' + b.players + '" data-build="' + b.id + '" aria-label="Jugadores con esta build">' +
      '<button type="button" class="step" data-action="inc" data-build="' + b.id + '" aria-label="Más jugadores">+</button><span class="pl-label">jugadores</span></div>') +
      '<div class="b-tools"><button type="button" class="btn" data-action="dup" data-build="' + b.id + '">Duplicar</button>' +
      '<button type="button" class="btn danger' + (armedDelete === b.id ? ' armed' : '') + '" data-action="del" data-build="' + b.id + '">' + (armedDelete === b.id ? '¿Borrar?' : 'Borrar') + '</button></div></header>' +
      '<div class="slots">' + SLOTS.map(function (s) { return slotHtml(b, s); }).join('') + '</div>' +
      (guide ? '<footer class="b-foot"><span><b>' + pp + '</b> items en la guía</span><span>Tier mínimo por slot (tier + encantamiento)</span></footer>'
        : '<footer class="b-foot"><span><b>' + pp + '</b> items por jugador</span><span><b>' + pp * b.players + '</b> items en total (' + b.players + ' × ' + pp + ')</span></footer>') + memberLine(b) + '</article>';
  }
  function renderBuilds() {
    var host = $('#builds');
    var cur = state.prefs.role, html = '', gmode = state.prefs.mode === 'guides', src = curList();
    document.querySelectorAll('#mode-tabs [data-mode]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.mode === state.prefs.mode)); });
    var pmode = state.prefs.mode === 'players', kmode = state.prefs.mode === 'killboard';
    $('#kb').hidden = !kmode; host.hidden = kmode;
    $('.col-builds .sec-h h2').textContent = kmode ? 'Killboard' : 'Builds';
    if (kmode) {
      ['#role-tabs', '#add', '#clear-builds', '#pl-tools', '#guide-hint', '#example-hint', '#regear-done'].forEach(function (x) { $(x).hidden = true; });
      $('#bt-open').hidden = false;
      renderKillboard();
      return;
    }
    $('#role-tabs').hidden = pmode; $('#add').hidden = pmode; $('#clear-builds').hidden = pmode; $('#pl-tools').hidden = !pmode;
    if (pmode) {
      $('#regear-done').hidden = false; $('#bt-open').hidden = false; $('#guide-hint').hidden = true; $('#example-hint').hidden = true;
      renderPlayers(host);
      return;
    }
    $('#regear-done').hidden = gmode; $('#bt-open').hidden = gmode;
    $('#guide-hint').hidden = !gmode;
    $('#clear-builds').textContent = gmode ? 'Limpiar guías' : 'Limpiar builds';
    var label = ROLES.filter(function (r) { return r.id === cur; })[0].label;
    $('#role-tabs').innerHTML = ROLES.map(function (r) {
      var n = src.filter(function (x) { return x.role === r.id; }).length;
      return '<button type="button" class="rtab role-' + r.id + '" data-role="' + r.id + '" aria-pressed="' + (r.id === cur) + '"><span class="role-dot" aria-hidden="true"></span>' +
        '<span class="rt-name">' + r.label + '</span><span class="rt-n">' + n + '</span></button>';
    }).join('');
    // Se muestran de mayor a menor nivel (tier + encantamiento; equivalente: 6.3 = 8.1) según el arma, o el item de mayor nivel si no hay arma; el orden guardado no cambia.
    function rank(b) {
      function lv(it) { return (it.tier + it.ench) * 10 + it.tier; }
      if (b.slots.weapon) return lv(b.slots.weapon);
      return Object.keys(b.slots).reduce(function (a, k) { return Math.max(a, lv(b.slots[k])); }, 0);
    }
    var list = src.filter(function (x) { return x.role === cur; }).map(function (x, i) { return { b: x, i: i }; })
      .sort(function (a, c) { return rank(c.b) - rank(a.b) || a.i - c.i; }).map(function (x) { return x.b; });
    if (list.length) {
      var players = list.reduce(function (a, x) { return a + x.players; }, 0);
      var items = list.reduce(function (a, x) { return a + perPlayer(x) * x.players; }, 0);
      html = '<section class="role-grp role-' + cur + '" aria-label="Builds ' + label + '"><h3 class="role-h"><span class="role-dot" aria-hidden="true"></span>' +
        '<span class="role-name">' + label + '</span><span class="role-sub">' + (gmode ? list.length + (list.length === 1 ? ' guía' : ' guías') : players + (players === 1 ? ' jugador' : ' jugadores') + ' · ' + items + ' items') + '</span></h3>' +
        list.map(buildHtml).join('') + '</section>';
    }
    host.innerHTML = html || '<p class="empty">No hay ' + (gmode ? 'guías' : 'builds') + ' de ' + label + '. Crea una con «' + (gmode ? 'Nueva guía' : 'Nueva build') + '».</p>';
    wireIcons(host);
    $('#example-hint').hidden = gmode || !state.builds.some(function (b) { return /^Ejemplo/.test(b.name); });
  }

  /* ---------- Cofre ---------- */
  function sortRows(a, b) {
    return (b.tier + b.ench) - (a.tier + a.ench) || b.tier - a.tier || nameOf(byKey.get(a.key), a.tier).localeCompare(nameOf(byKey.get(b.key), b.tier));
  }
  function stateTag(r) {
    var m = missingOf(r);
    return m > 0 ? '<span class="miss">Faltan ' + m + '</span>' : '<span class="okk">Cubierto</span>';
  }
  // Aviso cuando parte del stock viene de items equivalentes (ej. 6.3 para una necesidad 8.1).
  function eqNote(r) {
    var others = groupIds(r.key, r.tier + r.ench).filter(function (i) { return i !== r.id && stockOf(i) > 0; });
    return others.map(function (i) { var p = idParts(i); return stockOf(i) + '× ' + tagText(p.tier, p.ench); }).join(' · ').replace(/^(.+)$/, 'incl. $1');
  }
  function partsNote(r) {
    return r.parts.length > 1 ? 'Incluye ' + r.parts.map(function (pt) { return pt.count + '× ' + tagText(pt.tier, pt.ench); }).join(' · ') : '';
  }
  function belowHtml(r) {
    var cap = r.capped && r.capped.length ? '<span class="cap-note">↧ Se reequipa con el tier de la guía: ' + r.capped.map(function (c) {
      return (c.names.length ? esc(c.names.join(', ')) + ' ' : '') + 'llevaba ' + tagText(c.had.tier, c.had.ench);
    }).join(' · ') + '</span>' : '';
    if (!r.below || !r.below.length) return cap;
    return cap + '<span class="under-note">⚠ ' + r.below.map(function (b) {
      return esc(b.names.join(', ')) + ' (lleva ' + tagText(b.have.tier, b.have.ench) + ', guía ' + tagText(b.need.tier, b.need.ench) + ')';
    }).join(' · ') + '</span>';
  }
  function rowHtml(r) {
    var nm = nameOf(byKey.get(r.key), r.tier), done = !!state.checked[r.id], p = state.prices[r.id], m = missingOf(r);
    return '<li class="row' + (done ? ' done' : '') + (r.below && r.below.length ? ' under' : '') + '" data-id="' + esc(r.id) + '"><label class="r-lab"><input type="checkbox" class="chk" data-id="' + esc(r.id) + '"' + (done ? ' checked' : '') + '>' +
      '<span class="box" aria-hidden="true"></span>' + iconHtml(r.id, nm, true) + '<span class="r-txt"><span class="r-name">' + esc(nm) + '</span>' +
      '<span class="r-meta">' + tagHtml(r.tier, r.ench) + '<span class="r-state">' + stateTag(r) + '</span></span>' + (r.parts.length > 1 ? '<span class="eq-parts">' + esc(partsNote(r)) + '</span>' : '') + belowHtml(r) + '</span></label>' +
      '<span class="r-count" aria-label="' + r.count + ' unidades">×' + r.count + '</span>' +
      '<div class="r-px">' + stockCtl(r.id, nm, poolOf(r), eqNote(r)) + '<input class="px-in" type="number" inputmode="numeric" min="0" step="1" placeholder="Precio c/u" value="' + (p > 0 ? p : '') + '" data-id="' + esc(r.id) +
      '" aria-label="Precio unitario de ' + esc(nm) + '"><span class="mr-sub" title="Precio de lo que falta">' + (p > 0 && m > 0 ? fmt.format(p * m) : '—') + '</span></div></li>';
  }
  function updateItemSilver() {
    var rows = Array.from(totals().values()), total = 0, missing = 0;
    rows.forEach(function (r) { var m = missingOf(r), p = state.prices[r.id]; if (!m) return; if (p > 0) total += p * m; else missing++; });
    var pending = rows.filter(function (r) { return missingOf(r) > 0; }).length;
    $('#i-num').textContent = fmt.format(total);
    $('#i-warn').textContent = !pending ? (rows.length ? 'Todo está cubierto con el stock.' : '') : (missing ? missing + ' de ' + pending + ' sin precio: el total es parcial.' : 'Todos los items que faltan tienen precio.');
    document.querySelectorAll('#manifest-body .row').forEach(function (li) {
      var r = rows.filter(function (x) { return x.id === li.dataset.id; })[0], p = r && state.prices[r.id];
      if (r) li.querySelector('.mr-sub').textContent = p > 0 && missingOf(r) > 0 ? fmt.format(p * missingOf(r)) : '—';
    });
  }
  function updateStats() {
    var rows = Array.from(totals().values());
    var total = rows.reduce(function (a, r) { return a + r.count; }, 0);
    var done = rows.reduce(function (a, r) { return a + (state.checked[r.id] ? r.count : 0); }, 0);
    var miss = rows.reduce(function (a, r) { return a + missingOf(r); }, 0);
    $('#m-num').textContent = total;
    $('#mb-count').textContent = total;
    $('#m-stats').textContent = rows.length + ' tipos distintos · ' + done + ' de ' + total + ' sacados · ' + (total - miss) + ' en stock · ' + miss + ' faltan' + (deniedUnits() ? ' · ' + deniedUnits() + ' denegados' : '');
    $('#m-bar').style.width = (total ? Math.round(done / total * 100) : 0) + '%';
  }
  function renderManifest() {
    var rows = Array.from(totals().values()), host = $('#manifest-body'), html = '';
    SLOTS.forEach(function (s) {
      var list = rows.filter(function (r) { return r.slot === s.id; }).sort(sortRows);
      if (!list.length) return;
      var sub = list.reduce(function (a, r) { return a + r.count; }, 0);
      html += '<section class="grp"><h3><span>' + s.label + '</span><span class="sub">' + sub + '</span></h3><ul>' + list.map(rowHtml).join('') + '</ul></section>';
    });
    host.innerHTML = html || '<p class="empty">Aún no hay items. Elige equipo en las builds y aquí aparece cuánto sacar del cofre.</p>';
    wireIcons(host);
    updateStats();
    updateItemSilver();
  }
  function renderAll() { renderBuilds(); renderManifest(); renderMats(); }

  function manifestText() {
    var rows = Array.from(totals().values()), lines = ['COFRE · REGEAR'], total = 0, value = 0, missing = 0;
    SLOTS.forEach(function (s) {
      var list = rows.filter(function (r) { return r.slot === s.id; }).sort(sortRows);
      if (!list.length) return;
      lines.push('', s.label.toUpperCase());
      list.forEach(function (r) {
        var p = state.prices[r.id];
        total += r.count;
        if (missingOf(r) > 0) { if (p > 0) value += p * missingOf(r); else missing++; }
        var m = missingOf(r);
        lines.push(r.count + '× ' + tagText(r.tier, r.ench) + ' ' + nameOf(byKey.get(r.key), r.tier) + (r.parts.length > 1 ? ' (' + partsNote(r).toLowerCase() + ')' : '') + (m < r.count ? ' [' + (m ? 'faltan ' + m : 'cubierto') + ']' : '') + (r.capped && r.capped.length ? ' ↧ con tier de la guía (llevaban más)' : '') + (r.below && r.below.length ? ' ⚠ bajo la guía: ' + r.below.map(function (b) { return b.names.join(', '); }).join('; ') : '') + (p > 0 && m > 0 ? ' — ' + fmt.format(p) + ' c/u = ' + fmt.format(p * m) : ''));
      });
    });
    lines.push('', 'Total: ' + total + ' items');
    if (value > 0) lines.push('Valor aprox. de lo que falta: ' + fmt.format(value) + ' silver' + (missing ? ' (' + missing + ' sin precio)' : ''));
    return lines.join('\n');
  }
  var flashTimers = {};
  function flash(sel, msg, ms) {
    var el = $(sel); el.textContent = msg;
    clearTimeout(flashTimers[sel]);
    flashTimers[sel] = setTimeout(function () { el.textContent = ''; }, ms || 4000);
  }
  function copyText(text, fb, statusSel) {
    var done = function () { if (fb) fb.hidden = true; flash(statusSel, 'Copiado al portapapeles.'); };
    var manual = function () {
      if (fb) { fb.hidden = false; fb.value = text; fb.focus(); fb.select(); }
      flash(statusSel, 'No pude copiar solo. Texto seleccionado: usa Ctrl+C.');
    };
    try { navigator.clipboard.writeText(text).then(done, manual); } catch (e) { manual(); }
  }

  /* ---------- Materiales, artefactos y silver ---------- */
  var fmt = new Intl.NumberFormat('es-CL');
  var matRows = [], matIndex = {}, noRecipe = [];

  function recipeFor(key, t, e) {
    var r = REC.R[key];
    return r ? (r[t + '.' + e] || r[String(e)] || null) : null;
  }
  function expand(rid, t, e) { return rid.replace('T#_', 'T' + t + '_').replace(/@#$/, '@' + e); }
  function isArtefact(id) { return /_ARTEFACT_/.test(id) && !/TOKEN/.test(id); }
  function idLabel(id) {
    var t = /^T(\d)_/.exec(id), e = /@(\d)$/.exec(id);
    return t ? tagText(+t[1], e ? +e[1] : 0) : '';
  }
  function idTag(id) {
    var t = /^T(\d)_/.exec(id), e = /@(\d)$/.exec(id);
    return t ? tagHtml(+t[1], e ? +e[1] : 0) : '';
  }
  function computeMaterials() {
    var map = new Map();
    noRecipe = [];
    totals().forEach(function (row) {
      row.parts.forEach(function (pt) {
        var need = pt.miss;
        if (!need) return;
        var rc = recipeFor(row.key, pt.tier, pt.ench);
        if (!rc) { noRecipe.push(Object.assign({}, row, { tier: pt.tier, ench: pt.ench, count: need })); return; }
        rc.forEach(function (r) {
          var id = expand(r[0], pt.tier, pt.ench), cur = map.get(id), add = r[1] * need;
          if (cur) cur.qty += add; else map.set(id, { id: id, qty: add });
        });
      });
    });
    // Los consumibles salen fraccionados por unidad; se redondea hacia arriba el total de cada material.
    return Array.from(map.values()).map(function (m) {
      var need = Math.max(1, Math.ceil(Math.round(m.qty * 1e6) / 1e6)), have = stockOf(m.id);
      return { id: m.id, name: REC.N[m.id] || m.id, need: need, have: have, count: Math.max(0, need - have), art: isArtefact(m.id) };
    }).filter(function (m) { return m.count > 0 || m.have > 0; });
  }
  function subtotal(r) { var p = state.prices[r.id]; return p > 0 ? p * r.count : 0; }
  function sortMats(a, b) { return subtotal(b) - subtotal(a) || b.count - a.count || a.name.localeCompare(b.name); }
  function matRowHtml(r) {
    var p = state.prices[r.id];
    return '<li class="mrow" data-id="' + esc(r.id) + '"><div class="mr-main">' + iconHtml(r.id, r.name, true) +
      '<span class="r-txt"><span class="r-name">' + esc(r.name) + '</span><span class="r-meta">' + idTag(r.id) + (r.have ? '<span class="r-state"><span class="' + (r.count ? 'miss' : 'okk') + '">' + (r.count ? 'Necesitas ' + r.need + ' · stock ' + r.have : 'Cubierto por stock (' + r.have + ')') + '</span></span>' : '') + '</span></span></div>' +
      '<span class="r-count" aria-label="' + r.count + ' unidades">×' + fmt.format(r.count) + '</span>' +
      '<input class="px-in" type="number" inputmode="numeric" min="0" step="1" placeholder="Precio c/u" value="' + (p > 0 ? p : '') + '" data-id="' + esc(r.id) + '" aria-label="Precio unitario de ' + esc(r.name) + '">' +
      '<span class="mr-sub">—</span></li>';
  }
  var MAT_GROUPS = [['Artefactos', true], ['Materiales', false]];
  function renderMats() {
    matRows = computeMaterials();
    matIndex = {};
    matRows.forEach(function (r) { matIndex[r.id] = r; });
    var host = $('#mats-body'), html = '';
    MAT_GROUPS.forEach(function (g) {
      var list = matRows.filter(function (r) { return r.art === g[1]; }).sort(sortMats);
      if (!list.length) return;
      var units = list.reduce(function (a, r) { return a + r.count; }, 0);
      html += '<section class="grp"><h3><span>' + g[0] + '</span><span class="sub">' + fmt.format(units) + '</span></h3><ul>' + list.map(matRowHtml).join('') + '</ul></section>';
    });
    if (noRecipe.length) {
      html += '<p class="empty">Sin receta en los datos, no suman: ' + noRecipe.map(function (r) { return esc(nameOf(byKey.get(r.key), r.tier)) + ' ×' + r.count; }).join(', ') + '.</p>';
    }
    host.innerHTML = html || '<p class="empty">Aún no hay materiales. Elige items en las builds para ver qué hay que craftear.</p>';
    wireIcons(host);
    updateSilver();
  }
  function updateSilver() {
    var total = 0, missing = 0, arts = 0, mats = 0;
    matRows.forEach(function (r) {
      if (r.art) arts++; else mats++;
      var p = state.prices[r.id];
      if (p > 0) total += p * r.count; else missing++;
    });
    $('#s-num').textContent = fmt.format(total);
    $('#s-stats').textContent = mats + ' materiales distintos · ' + arts + ' artefactos distintos';
    $('#s-warn').textContent = !matRows.length ? '' : (missing ? missing + ' de ' + matRows.length + ' sin precio: el total es parcial.' : 'Todos los materiales tienen precio.');
    document.querySelectorAll('#mats-body .mrow').forEach(function (li) {
      var r = matIndex[li.dataset.id], p = state.prices[r.id];
      li.querySelector('.mr-sub').textContent = p > 0 ? fmt.format(p * r.count) : '—';
    });
  }
  function matsText() {
    var lines = ['MATERIALES · REGEAR'], total = 0, missing = 0;
    MAT_GROUPS.forEach(function (g) {
      var list = matRows.filter(function (r) { return r.art === g[1]; }).sort(sortMats);
      if (!list.length) return;
      lines.push('', g[0].toUpperCase());
      list.forEach(function (r) {
        var p = state.prices[r.id], tag = idLabel(r.id);
        if (p > 0) total += p * r.count; else missing++;
        lines.push(r.count + '× ' + r.name + (tag ? ' (' + tag + ')' : '') + (p > 0 ? ' — ' + fmt.format(p) + ' c/u = ' + fmt.format(p * r.count) : ''));
      });
    });
    lines.push('', 'Total aprox.: ' + fmt.format(total) + ' silver' + (missing ? ' (' + missing + ' sin precio)' : ''));
    return lines.join('\n');
  }

  // Precios del Albion Online Data Project: solo responde si la página se aloja fuera del visor de Claude.
  async function fetchPrices() {
    var ids = Array.from(totals().values()).filter(function (r) { return missingOf(r) > 0; }).map(function (r) { return r.id; }).concat(matRows.map(function (r) { return r.id; })).filter(function (id, i, a) { return a.indexOf(id) === i; });
    if (!ids.length) { flash('#s-status', 'No hay items ni materiales para consultar.'); return; }
    var btn = $('#px-api'), host = state.prefs.server, city = state.prefs.city, got = 0;
    btn.disabled = true;
    $('#s-status').textContent = 'Consultando precios…';
    try {
      for (var i = 0; i < ids.length; i += 40) {
        var path = ids.slice(i, i + 40).map(encodeURIComponent).join(',');
        var res = await fetch('https://' + host + '.albion-online-data.com/api/v2/stats/prices/' + path + '.json?locations=' + encodeURIComponent(city));
        if (!res.ok) throw new Error('HTTP ' + res.status);
        var data = await res.json(), best = {};
        data.forEach(function (d) {
          if (d.city === city && d.sell_price_min > 0 && (!best[d.item_id] || d.sell_price_min < best[d.item_id])) best[d.item_id] = d.sell_price_min;
        });
        Object.keys(best).forEach(function (id) { state.prices[id] = best[id]; got++; });
      }
      save(); renderMats(); renderManifest();
      flash('#s-status', got + ' de ' + ids.length + ' precios actualizados (venta mínima en ' + city + ').', 8000);
    } catch (e) {
      $('#s-status').textContent = '';
      flash('#s-status', 'No se pudo consultar la API. Dentro de Claude las conexiones externas están bloqueadas; al alojar la página en tu sitio funciona. Mientras tanto escribe o pega los precios.', 12000);
    } finally {
      btn.disabled = false;
    }
  }

  $('#mats-body').addEventListener('change', function (ev) {
    var t = ev.target;
    if (!t.classList.contains('px-in')) return;
    var v = Math.round(parseFloat(t.value));
    if (v > 0) state.prices[t.dataset.id] = v; else delete state.prices[t.dataset.id];
    save(); updateSilver(); updateItemSilver();
  });
  $('#px-api').addEventListener('click', fetchPrices);
  $('#copy-mats').addEventListener('click', function () { copyText(matsText(), $('#mats-fb'), '#s-status'); });
  // Nombre (en español) -> ids de material. Un nombre puede repetirse entre tiers o encantamientos; se desambigua con T8 o T8.1.
  var matByName = null;
  function matNames() {
    if (matByName) return matByName;
    matByName = {};
    Object.keys(REC.N).forEach(function (id) { (matByName[plain(REC.N[id])] = matByName[plain(REC.N[id])] || []).push(id); });
    return matByName;
  }
  function parsePriceLine(line) {
    var m = /^\s*(.+?)[\s;:=]+(\d[\d.,\s]*)\s*$/.exec(line);
    if (!m) return null;
    var label = m[1].trim(), price = parseInt(m[2].replace(/\D/g, ''), 10);
    if (!(price > 0)) return null;
    var direct = /^(T\d_[A-Za-z0-9_]+(?:@\d)?)$/.exec(label);
    if (direct) return { ids: [direct[1]], price: price };
    var tg = /\s*\(?\bT([1-8])(?:\.([0-4]))?\)?\s*$/i.exec(label), tier = null, ench = null;
    if (tg) { tier = +tg[1]; ench = tg[2] != null ? +tg[2] : null; label = label.slice(0, tg.index); }
    var ids = (matNames()[plain(label.trim())] || []).filter(function (id) {
      var t = /^T(\d)_/.exec(id), e = /@(\d)$/.exec(id);
      return (tier == null || (t && +t[1] === tier)) && (ench == null || (e ? +e[1] : 0) === ench);
    });
    return ids.length ? { ids: ids, price: price } : null;
  }
  $('#px-load').addEventListener('click', function () {
    var n = 0, bad = 0;
    $('#px-text').value.split(/\r?\n/).forEach(function (line) {
      if (!line.trim()) return;
      var r = parsePriceLine(line);
      if (!r) { bad++; return; }
      r.ids.forEach(function (id) { state.prices[id] = r.price; });
      n++;
    });
    save(); renderMats(); renderManifest();
    flash('#s-status', n ? n + ' precios cargados' + (bad ? ' · ' + bad + ' líneas no reconocidas' : '.') : 'No encontré líneas válidas. Formato: Tablas de maderablanca 1500', 6000);
  });
  var clearTimer = null;
  $('#px-clear').addEventListener('click', function () {
    var b = this;
    if (!clearTimer) {
      b.textContent = '¿Borrar precios?';
      clearTimer = setTimeout(function () { clearTimer = null; b.textContent = 'Borrar precios'; }, 3000);
      return;
    }
    clearTimeout(clearTimer); clearTimer = null; b.textContent = 'Borrar precios';
    state.prices = {}; save(); renderMats(); renderManifest();
  });
  $('#srv').innerHTML = Object.keys(SERVERS).map(function (k) { return '<option value="' + k + '">' + SERVERS[k] + '</option>'; }).join('');
  $('#city').innerHTML = CITIES.map(function (c) { return '<option>' + c + '</option>'; }).join('');
  $('#srv').value = state.prefs.server;
  $('#city').value = state.prefs.city;
  $('#srv').addEventListener('change', function (ev) { setServer(ev.target.value); });
  $('#city').addEventListener('change', function (ev) { state.prefs.city = ev.target.value; save(); });

  document.querySelectorAll('.tabs [data-tab]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var tab = btn.dataset.tab;
      $('#panel-items').hidden = tab !== 'items';
      $('#panel-mats').hidden = tab !== 'mats';
      document.querySelectorAll('.tabs [data-tab]').forEach(function (o) { o.setAttribute('aria-selected', String(o === btn)); });
    });
  });

  /* ---------- Importar pelea (API gameinfo de Albion) ---------- */
  var GAMEINFO = { west: 'https://gameinfo.albiononline.com', east: 'https://gameinfo-sgp.albiononline.com', europe: 'https://gameinfo-ams.albiononline.com' };
  var GEAR_SLOTS = { MainHand: 'weapon', OffHand: 'offhand', Head: 'head', Armor: 'armor', Shoes: 'shoes', Cape: 'cape' };
  var bt = { data: null, guild: '', includeSeen: false, entries: [], sel: {}, role: {} };

  function parseItemType(type, slot) {
    var m = /^T(\d)_(.+?)(?:@(\d))?$/.exec(type || '');
    if (!m) return { unknown: String(type) };
    var t = +m[1], e = +(m[3] || 0), def = byKey.get(m[2]);
    if (!def || def.slot !== slot || !hasTier(def, t) || !hasEnch(def, e)) return { unknown: type };
    return { key: m[2], tier: t, ench: e };
  }
  function gearFrom(eq) {
    var slots = {}, unknown = [];
    Object.keys(GEAR_SLOTS).forEach(function (k) {
      var it = eq && eq[k];
      if (!it || !it.Type) return;
      var p = parseItemType(it.Type, GEAR_SLOTS[k]);
      if (p.unknown) unknown.push(p.unknown);
      else slots[GEAR_SLOTS[k]] = { key: p.key, tier: p.tier, ench: p.ench, qty: 1 };
    });
    if (slots.weapon && byKey.get(slots.weapon.key).two) delete slots.offhand;
    return { slots: slots, unknown: unknown };
  }
  // Rol sugerido a partir del arma y la mano secundaria; se puede cambiar en la lista.
  function guessRole(slots) {
    var w = slots.weapon ? slots.weapon.key : '', o = slots.offhand ? slots.offhand.key : '';
    if (/HOLYSTAFF|NATURESTAFF|DIVINESTAFF|WILDSTAFF/.test(w)) return 'healer';
    if (/ENIGMATIC|RINGPAIR|ARCANESTAFF_HELL|ARCANESTAFF_UNDEAD/.test(w)) return 'support';
    if (/SHIELD/.test(o) || /MACE|HAMMER|RAM_KEEPER/.test(w)) return 'tank';
    return 'dps';
  }
  function hasGear(g) { return Object.keys(g.slots).length > 0; }

  function eqOf(p) {
    var out = {};
    Object.keys(p && p.Equipment || {}).forEach(function (k) { var it = p.Equipment[k]; if (it && it.Type) out[k] = { Type: it.Type, Count: it.Count || 1 }; });
    return out;
  }
  function killInfo(ev) {
    function who(p) { return p ? { name: p.Name || '?', guild: p.GuildName || '', alliance: p.AllianceName || '', ip: Math.round(p.AverageItemPower || 0), eq: eqOf(p) } : null; }
    var inv = (ev.Victim && ev.Victim.Inventory || []).filter(function (i) { return i && i.Type; }).map(function (i) { return { Type: i.Type, Count: i.Count || 1 }; });
    return { time: Date.parse(ev.TimeStamp) || 0, fame: ev.TotalVictimKillFame || 0, killer: who(ev.Killer), victim: who(ev.Victim), inv: inv };
  }

  // Une las peleas y los eventos en gremios -> jugadores -> muertes y último equipo visto.
  function ingest(ids, battles, events) {
    var guilds = {}, seenEv = {}, kills = 0, fame = 0;
    function guildOf(name, alliance) {
      name = name || '(sin gremio)';
      var g = guilds[name] || (guilds[name] = { name: name, alliance: '', players: {}, deaths: 0 });
      if (!g.alliance && alliance) g.alliance = alliance;
      return g;
    }
    function playerOf(g, id, name) {
      if (id && g.players[id]) return g.players[id];
      var k = Object.keys(g.players).filter(function (x) { return g.players[x].name === name; })[0];
      if (k) return g.players[k];
      var pl = { id: id || name, name: name, deaths: [], seen: null, seenTime: 0 };
      g.players[pl.id] = pl;
      return pl;
    }
    function touch(p, time) {
      if (!p || !p.Name) return null;
      var g = guildOf(p.GuildName, p.AllianceName), pl = playerOf(g, p.Id, p.Name), gear = gearFrom(p.Equipment);
      if (hasGear(gear) && time >= pl.seenTime) { pl.seen = gear; pl.seenTime = time; }
      return { g: g, pl: pl, gear: gear };
    }
    battles.forEach(function (b) {
      if (!b) return;
      kills += +b.totalKills || 0; fame += +b.totalFame || 0;
      var list = Array.isArray(b.players) ? b.players : Object.keys(b.players || {}).map(function (k) { var x = b.players[k]; return x && typeof x === 'object' ? Object.assign({ id: k }, x) : null; });
      list.forEach(function (x) {
        var name = x && (x.name || x.Name);
        if (name) playerOf(guildOf(x.guildName || x.GuildName, x.allianceName || x.AllianceName), x.id || x.Id, name);
      });
    });
    var n = 0;
    events.forEach(function (ev) {
      if (!ev || !ev.Victim) return;
      var eid = ev.EventId != null ? ev.EventId : String(ev.TimeStamp) + ':' + (ev.Victim.Id || ev.Victim.Name);
      if (seenEv[eid]) return;
      seenEv[eid] = true; n++;
      var time = Date.parse(ev.TimeStamp) || 0, v = touch(ev.Victim, time);
      if (v) { v.pl.deaths.push({ eventId: eid, time: time, gear: v.gear, kill: killInfo(ev) }); v.g.deaths++; }
      touch(ev.Killer, time);
      (ev.Participants || []).forEach(function (p) { touch(p, time); });
      (ev.GroupMembers || []).forEach(function (p) { touch(p, time); });
    });
    return { ids: ids, guilds: guilds, events: n, kills: kills || n, fame: fame };
  }

  function computeEntries() {
    var g = bt.data && bt.data.guilds[bt.guild], out = [];
    if (g) {
      Object.keys(g.players).forEach(function (pid) {
        var pl = g.players[pid];
        pl.deaths.forEach(function (d) {
          if (hasGear(d.gear)) out.push({ uid: pid + ':' + d.eventId, player: pl.name, kind: 'death', time: d.time, gear: d.gear, kill: d.kill });
        });
        if (!pl.deaths.length && bt.includeSeen && pl.seen && hasGear(pl.seen)) out.push({ uid: pid + ':seen', player: pl.name, kind: 'seen', time: pl.seenTime, gear: pl.seen });
      });
    }
    out.sort(function (a, b) { return a.player.localeCompare(b.player) || a.time - b.time; });
    out.forEach(function (e) { if (!(e.uid in bt.role)) bt.role[e.uid] = guessRole(e.gear.slots); });
    bt.entries = out;
  }
  function selectedEntries() { return bt.entries.filter(function (e) { return bt.sel[e.uid] !== false; }); }
  function groupEntries(list) {
    var map = {}, order = [];
    list.forEach(function (e) {
      var role = bt.role[e.uid] || 'dps';
      var sig = role + '|' + SLOTS.map(function (s) { var it = e.gear.slots[s.id]; return it ? it.key + ':' + it.tier + ':' + it.ench : '-'; }).join(',');
      var g = map[sig] || (map[sig] = { role: role, slots: e.gear.slots, count: 0, names: [], kills: [] });
      if (g.count === 0) order.push(g);
      g.count++; g.names.push(e.player); g.kills.push(e.kill || null);
    });
    return order;
  }

  function setBt(msg, isErr) {
    var el = $('#bt-status');
    el.textContent = msg || '';
    el.classList.toggle('err', !!isErr);
  }
  function setServer(v) {
    if (!SERVERS[v]) return;
    state.prefs.server = v; save();
    $('#srv').value = v; $('#bt-server').value = v;
    var base = GAMEINFO[v] + '/api/gameinfo';
    $('#bt-links').textContent = base + '/battles/ID  ·  ' + base + '/events/battle/ID?offset=0&limit=51';
  }
  function entryHtml(e, i) {
    var w = e.gear.slots.weapon, sel = bt.sel[e.uid] !== false;
    var parts = SLOTS.map(function (s) {
      var it = e.gear.slots[s.id];
      if (!it) return '';
      var nm = esc(nameOf(byKey.get(it.key), it.tier));
      return (s.id === 'weapon' ? '<b>' + nm + '</b>' : nm) + ' ' + tagHtml(it.tier, it.ench);
    }).filter(Boolean);
    var chk = deficits(e.gear.slots, guideFor(e.gear.slots, bt.role[e.uid])), bad = Object.keys(chk);
    var badTxt = bad.map(function (k) { return SLOT_LABEL[k] + ' ' + tagText(chk[k].have.tier, chk[k].have.ench) + ' (guía ' + tagText(chk[k].need.tier, chk[k].need.ench) + ')'; }).join(' · ');
    return '<li class="bt-item' + (bad.length ? ' under' : '') + '"><label class="bt-who"><input type="checkbox" class="chk bt-sel" data-i="' + i + '"' + (sel ? ' checked' : '') + '><span class="box" aria-hidden="true"></span>' +
      (w ? iconHtml(itemId(w.key, w.tier, w.ench), nameOf(byKey.get(w.key), w.tier), true) : '') +
      '<span class="bt-name">' + esc(e.player) + '</span><span class="bt-kind ' + e.kind + '">' + (e.kind === 'death' ? 'murió' : 'no murió') + '</span></label>' +
      (e.kill && e.kill.killer ? '<button type="button" class="btn sm" data-kill="' + i + '">Ver quién lo mató</button>' : '<span></span>') +
      '<select class="sel bt-role" data-i="' + i + '" aria-label="Rol de ' + esc(e.player) + '">' + roleOptions(bt.role[e.uid]) + '</select>' +
      '<div class="bt-gear">' + parts.join('<span aria-hidden="true">·</span>') +
      (bad.length ? '<span class="under-note">⚠ Bajo la guía: ' + esc(badTxt) + '</span>' : '') +
      (e.gear.unknown.length ? '<span class="bt-warn">· ' + e.gear.unknown.length + ' item(s) no reconocido(s)</span>' : '') + '</div></li>';
  }
  function updateBtFoot() {
    var groups = groupEntries(selectedEntries());
    $('#bt-count').textContent = selectedEntries().length + ' de ' + bt.entries.length + ' seleccionados · ' + groups.length + (groups.length === 1 ? ' build distinta' : ' builds distintas');
    $('#bt-add').disabled = !groups.length;
  }
  function renderBattle() {
    var body = $('#bt-body'), foot = $('#bt-foot'), d = bt.data;
    if (!d) {
      body.innerHTML = (proxyChecked && !proxyOn ? '<p class="bt-empty bt-warn">No hay puente hacia la API de Albion, así que el navegador bloqueará la consulta. Ejecuta <code>npm start</code> en la carpeta del proyecto, publica la función <code>albion-proxy</code> en Supabase (ver README) o usa «Pegar el JSON de la pelea».</p>' : '') +
        '<p class="bt-empty">Pega el ID o el enlace de una pelea de AlbionZvZ, AlbionBB o del killboard oficial, o un multi de AlbionBB con varias peleas. Verás qué miembros de cada gremio estuvieron y con qué equipo murieron, y de ahí salen las builds del regear.</p>';
      foot.hidden = true;
      return;
    }
    var names = Object.keys(d.guilds).sort(function (a, b) {
      return d.guilds[b].deaths - d.guilds[a].deaths || Object.keys(d.guilds[b].players).length - Object.keys(d.guilds[a].players).length || a.localeCompare(b);
    });
    if (!names.length) {
      body.innerHTML = '<p class="bt-empty">La pelea no trae jugadores.</p>';
      foot.hidden = true;
      return;
    }
    if (!d.guilds[bt.guild]) bt.guild = d.guilds[state.prefs.guild] ? state.prefs.guild : '';
    computeEntries();
    var opts = (bt.guild ? '' : '<option value="" selected>Elige tu gremio…</option>') + names.map(function (n) {
      var g = d.guilds[n];
      return '<option value="' + esc(n) + '"' + (n === bt.guild ? ' selected' : '') + '>' + esc(n) + (g.alliance ? ' [' + esc(g.alliance) + ']' : '') + ' · ' +
        Object.keys(g.players).length + ' jugadores · ' + g.deaths + ' muertes</option>';
    }).join('');
    body.innerHTML = '<p class="bt-sum">' + (d.ids.length > 1 ? d.ids.length + ' peleas' : 'Pelea') + ' <b>' + esc(d.ids.join(', ')) + '</b> · <b>' + fmt.format(d.kills) + '</b> kills · <b>' + names.length + '</b> gremios · <b>' + d.events + '</b> eventos leídos</p>' +
      '<div class="bt-bar"><label>Gremio <select class="sel" id="bt-guild" aria-label="Gremio">' + opts + '</select></label>' +
      '<label><input type="checkbox" id="bt-seen"' + (bt.includeSeen ? ' checked' : '') + '> Incluir a quienes no murieron</label>' +
      '<button class="btn" type="button" data-bt="all">Todos</button><button class="btn" type="button" data-bt="none">Ninguno</button></div>' +
      (!bt.guild ? '<p class="bt-empty">Elige tu gremio para ver quiénes murieron y con qué equipo.</p>'
        : bt.entries.length ? '<ul class="bt-list">' + bt.entries.map(entryHtml).join('') + '</ul>'
        : '<p class="bt-empty">Nadie de este gremio murió en la pelea. Activa «Incluir a quienes no murieron» para usar el equipo con el que pelearon.</p>');
    wireIcons(body);
    foot.hidden = !bt.guild;
    updateBtFoot();
  }

  // La API gameinfo no envía cabeceras CORS: el navegador solo puede leerla a través del puente local de server.js.
  // Primero el puente local (npm start); si no está, la Edge Function de Supabase configurada en config.js.
  var proxyOn = false, proxyChecked = false, proxyBase = '/gameinfo';
  var CFG = window.REGEAR_CONFIG || {};
  var CLOUD_PROXY = CFG.supabaseUrl ? String(CFG.supabaseUrl).replace(/\/+$/, '') + '/functions/v1/albion-proxy' : '';
  // La función de Supabase exige la clave pública (anon) en la cabecera; el puente local no la necesita.
  function proxyInit(url) {
    return CLOUD_PROXY && CFG.supabaseAnonKey && url.indexOf(CLOUD_PROXY) === 0 ? { headers: { Authorization: 'Bearer ' + CFG.supabaseAnonKey, apikey: CFG.supabaseAnonKey } } : undefined;
  }
  async function ping(base) {
    try { var r = await fetch(base + '/ping', proxyInit(base)); return r.ok && (await r.json()).ok === true; }
    catch (e) { return false; }
  }
  // Una sola detección compartida: si dos llamadas llegan a la vez, la segunda espera a la primera
  // (antes devolvía «sin puente» mientras la primera aún esperaba la respuesta y la consulta salía directa, bloqueada por CORS).
  var proxyProbe = null;
  function detectProxy() {
    if (!proxyProbe) proxyProbe = (async function () {
      if (await ping('/gameinfo')) { proxyOn = true; proxyBase = '/gameinfo'; }
      else if (CLOUD_PROXY && await ping(CLOUD_PROXY)) { proxyOn = true; proxyBase = CLOUD_PROXY; }
      proxyChecked = true;
      return proxyOn;
    })();
    return proxyProbe;
  }
  function apiBase(server) { return proxyOn ? proxyBase + '/' + server + '/api/gameinfo' : GAMEINFO[server] + '/api/gameinfo'; }
  // La API de Albion a veces tarda o responde 5xx: se reintenta 2 veces antes de rendirse (un 404 no se reintenta).
  async function getJson(url) {
    var last;
    for (var attempt = 0; attempt < 3; attempt++) {
      if (attempt) await new Promise(function (r) { setTimeout(r, 1200 * attempt); });
      try {
        var res = await fetch(url, proxyInit(url));
        if (res.ok) return await res.json();
        last = new Error('HTTP ' + res.status); last.status = res.status;
        if (res.status < 500 && res.status !== 429) throw last;
      } catch (e) {
        if (e.status && e.status < 500 && e.status !== 429) throw e;
        last = e;
      }
    }
    throw last;
  }
  // Toma el ID del enlace (/battles/ID) e ignora números de parámetros como ?t=1730000000.
  // Reconoce, en cualquier mezcla y cantidad:
  //   multi de AlbionBB  …/battles/multi?ids=123,456   (también &ids=…, %2C o espacios entre IDs)
  //   pelea suelta       …/battles/123  o  …/battles/123,456  (AlbionBB, AlbionZvZ, killboard oficial)
  //   IDs sueltos        123456789 987654321
  // Los números de otros parámetros (p. ej. ?t=1730000000) no se toman como peleas.
  var MAX_BATTLES = 30;
  function parseBattleIds(text) {
    var s = String(text || ''), ids = [], m;
    function add(x) { if (x && x.length >= 6 && x.length <= 12 && ids.indexOf(x) < 0) ids.push(x); }
    var reQ = /[?&#](?:ids|battles|battleids|battle_ids)=([^&#\s]+)/gi;
    while ((m = reQ.exec(s))) { var v; try { v = decodeURIComponent(m[1].replace(/\+/g, ' ')); } catch (e) { v = m[1]; } v.split(/[^\d]+/).forEach(add); }
    var reP = /battles?\/(\d[\d,]*)/gi;
    while ((m = reP.exec(s))) m[1].split(',').forEach(add);
    if (!ids.length) (s.replace(/https?:\/\/\S+/gi, ' ').match(/\d{6,12}/g) || []).forEach(add);
    return ids.slice(0, MAX_BATTLES);
  }
  function battleServerFromText(text) {
    if (/\/\/(?:www\.)?europe\.albion|gameinfo-ams|[?&]server=europe/i.test(text)) return 'europe';
    if (/\/\/(?:www\.)?east\.albion|gameinfo-sgp|[?&]server=(?:east|asia)/i.test(text)) return 'east';
    if (/\/\/(?:www\.)?(?:west\.)?albionbb\.com|[?&]server=(?:west|us|americas)/i.test(text)) return 'west';
    return '';
  }
  async function searchBattle() {
    var text = $('#bt-ids').value, ids = parseBattleIds(text);
    if (!ids.length) { setBt('Escribe el ID o pega el enlace de la pelea (también sirve un multi de AlbionBB).', true); return; }
    var srv = battleServerFromText(text);
    if (srv) setServer(srv);
    var btn = $('#bt-go'), battles = [], events = [], found = [], missing = [], failed = [], switched = '';
    btn.disabled = true;
    try {
      await detectProxy();
      for (var k = 0; k < ids.length; k++) {
        var id = ids[k], hit = null, any404 = false, lastErr = null;
        // Si la pelea no está en el servidor elegido, se prueba en los otros dos.
        var order = [state.prefs.server].concat(Object.keys(GAMEINFO).filter(function (x) { return x !== state.prefs.server; }));
        for (var j = 0; j < order.length && !hit; j++) {
          setBt((ids.length > 1 ? 'Pelea ' + (k + 1) + ' de ' + ids.length + ': ' : 'Buscando la pelea ') + id + ' (' + SERVERS[order[j]] + ')…');
          try { hit = { server: order[j], battle: await getJson(apiBase(order[j]) + '/battles/' + id) }; }
          catch (e) { if (e.status === 404) any404 = true; else lastErr = e; }
        }
        if (!hit) {
          if (!any404 && lastErr) throw lastErr;
          if (lastErr) failed.push(id); else missing.push(id); // con error en algún servidor no se puede asegurar que no exista
          continue;
        }
        if (hit.server !== state.prefs.server) { setServer(hit.server); switched = SERVERS[hit.server]; }
        found.push(id); battles.push(hit.battle);
        var base = apiBase(hit.server);
        for (var off = 0; off <= 1000; off += 51) {
          var page;
          try { page = await getJson(base + '/events/battle/' + id + '?offset=' + off + '&limit=51'); }
          catch (e2) { if (off > 0 && e2.status === 400) break; throw e2; }
          if (!Array.isArray(page)) break;
          events = events.concat(page);
          setBt((ids.length > 1 ? 'Pelea ' + (k + 1) + ' de ' + ids.length + ' · ' : 'Pelea ' + id + ': ') + events.length + ' eventos leídos…');
          if (page.length < 51) break;
        }
      }
      if (!found.length) {
        setBt((failed.length ? 'La API de Albion no respondió para ' + failed.join(', ') + '. Vuelve a intentar en un momento. ' : '') +
          (missing.length ? 'No encontré la pelea ' + missing.join(', ') + ' en ningún servidor (Américas, Asia ni Europa). Revisa el ID: es el número que va después de /battles/ en el enlace.' : ''), true);
        return;
      }
      if (loadBattleData(found, battles, events)) {
        var notes = [];
        if (found.length > 1) notes.push(found.length + ' peleas unidas: las muertes repetidas entre ellas se cuentan una vez.');
        if (switched) notes.push((found.length > 1 ? 'Las peleas están' : 'La pelea está') + ' en el servidor ' + switched + '.');
        if (missing.length) notes.push('No encontré: ' + missing.join(', ') + '.');
        if (failed.length) notes.push('La API de Albion no respondió para ' + failed.join(', ') + ': vuelve a buscar para sumarlas.');
        setBt(notes.join(' '));
      }
    } catch (e) {
      var blocked = !proxyOn && (e instanceof TypeError || /Failed to fetch|NetworkError/i.test(e && e.message));
      setBt(blocked
        ? 'El navegador bloquea la consulta a la API de Albion (CORS). Abre la página con «npm start» (trae un puente local) o usa «Pegar el JSON de la pelea» abajo.'
        : 'No se pudo consultar la API de Albion (' + (e && e.message ? e.message : 'sin conexión') + '). Revisa tu conexión o usa «Pegar el JSON de la pelea» abajo.', true);
    } finally {
      btn.disabled = false;
    }
  }
  function loadBattleData(ids, battles, events) {
    var data = ingest(ids, battles, events);
    if (!data.events) { setBt('La pelea no tiene eventos de muerte para leer.', true); return false; }
    bt.data = data; bt.guild = ''; bt.sel = {}; bt.role = {};
    renderBattle();
    setBt('');
    return true;
  }
  // Acepta el JSON de la pelea y/o de las páginas de eventos pegados uno tras otro.
  function usePasted() {
    var raw = $('#bt-paste').value.trim(), vals;
    if (!raw) { setBt('Pega primero el JSON en el cuadro.', true); return; }
    try { vals = [JSON.parse(raw)]; }
    catch (e1) {
      try { vals = JSON.parse('[' + raw.replace(/\]\s*\[/g, ',').replace(/\}\s*\{/g, '},{').replace(/\]\s*\{/g, '],{').replace(/\}\s*\[/g, '},[') + ']'); }
      catch (e2) { setBt('El texto pegado no es JSON válido. Copia la respuesta completa de cada enlace.', true); return; }
    }
    var battles = [], events = [];
    (function walk(v) {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') { if (v.Victim || v.Killer) events.push(v); else battles.push(v); }
    })(vals);
    var ids = battles.map(function (b) { return String(b.id || b.Id || ''); }).filter(Boolean);
    loadBattleData(ids.length ? ids : ['pegada'], battles, events);
  }
  function importSelected() {
    var groups = groupEntries(selectedEntries());
    if (!groups.length) return;
    var mode = document.querySelector('input[name="bt-mode"]:checked').value, replace = mode === 'replace';
    // Completa los datos de muerte de jugadores que ya están en tus builds (importadas antes de existir «Ver quién lo mató»).
    var filled = 0;
    if (!replace) {
      selectedEntries().forEach(function (e) {
        if (!e.kill) return;
        state.builds.forEach(function (b) {
          (b.members || []).forEach(function (n, j) {
            if (n !== e.player || j >= b.players || (b.kills && b.kills[j])) return;
            var kk = cleanKill(e.kill);
            if (kk) { b.kills = b.kills || {}; b.kills[j] = kk; filled++; }
          });
        });
      });
    }
    if (mode === 'kills') {
      save(); closeBattle(); renderAll();
      flash('#top-status', filled ? 'Se agregó la muerte de ' + filled + (filled === 1 ? ' jugador' : ' jugadores') + ' en tus builds.' : 'Ningún jugador de tus builds coincidía o ya tenían su muerte.', 8000);
      return;
    }
    var used = {}, made = [];
    if (!replace) state.builds.forEach(function (b) { used[b.name] = true; });
    groups.forEach(function (g) {
      var w = g.slots.weapon, base = w ? nameOf(byKey.get(w.key), w.tier) + ' ' + tagText(w.tier, w.ench) : 'Build', name = base, i = 1;
      while (used[name]) { i++; name = base + ' (' + i + ')'; }
      used[name] = true;
      made.push(cleanBuild({ name: name, role: g.role, players: g.count, slots: g.slots, members: g.names, kills: g.kills }));
    });
    state.builds = replace ? made : state.builds.concat(made);
    var first = ROLES.filter(function (r) { return made.some(function (b) { return b.role === r.id; }); })[0];
    if (first) state.prefs.role = first.id;
    state.prefs.guild = bt.guild;
    var people = made.reduce(function (a, b) { return a + b.players; }, 0);
    save(); closeBattle(); renderAll();
    flash('#top-status', made.length + (made.length === 1 ? ' build creada' : ' builds creadas') + ' para ' + people + (people === 1 ? ' regear' : ' regears') + ' (' + bt.guild + ').', 8000);
  }
  /* ---------- Killboard del gremio ---------- */
  // Muertes y kills recientes de un gremio (API gameinfo /events?guildId=). Desde aquí se ve el equipo de cada
  // muerte y se puede mandar al regear sin importar la pelea entera.
  var kb = { events: [], offset: 0, done: false, loading: false, err: '', filter: 'all', q: '', found: null, searching: false, added: {}, at: 0, scan: null };
  // La API oficial solo entrega las KILLS de un gremio. Las muertes se buscan miembro por miembro (/players/ID/deaths);
  // se guarda la fama de muerte de cada uno para revisar después solo a quienes murieron de nuevo.
  var KB_DEATH_DAYS = 30;
  function isDeath(ev, gid) { return !!(ev && (ev._death || (ev.Victim && ev.Victim.GuildId === gid))); }
  function dfCache(gid) { try { return JSON.parse(localStorage.getItem('regear-kb-df-' + gid) || '{}') || {}; } catch (e) { return {}; } }
  function dfSave(gid, c) { try { localStorage.setItem('regear-kb-df-' + gid, JSON.stringify(c)); } catch (e) { /* sin almacenamiento */ } }
  var KB_PAGE = 30;
  function relTime(ms) {
    var d = Math.max(0, Date.now() - ms) / 1000;
    if (d < 90) return 'hace un momento';
    if (d < 3600) return 'hace ' + Math.round(d / 60) + ' min';
    if (d < 86400) return 'hace ' + Math.round(d / 3600) + ' h';
    return new Date(ms).toLocaleDateString('es-CL', { day: 'numeric', month: 'short' }) + ' ' + new Date(ms).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
  }
  function kbSide(p, gid) {
    var w = p && p.Equipment && p.Equipment.MainHand, ti = w ? typeInfo(w.Type) : null, own = p && p.GuildId === gid;
    return '<span class="kb-who' + (own ? ' own' : '') + '">' + (w ? iconHtml(w.Type, ti.name, true) : '<span class="ic sm"><span class="ph">?</span></span>') +
      '<span class="kb-txt"><b class="kb-n">' + esc(p ? p.Name : '?') + '</b><span class="kb-g">' + esc(p && p.GuildName ? (p.AllianceName ? '[' + p.AllianceName + '] ' : '') + p.GuildName : 'Sin gremio') +
      (p && p.AverageItemPower ? ' · ' + fmt.format(Math.round(p.AverageItemPower)) + ' IP' : '') + '</span>' + (ti ? '<span class="kb-w">' + esc(ti.name) + ' ' + esc(ti.tag) + '</span>' : '') + '</span></span>';
  }
  function kbAlreadyAdded(ev) {
    if (kb.added[ev.EventId]) return true;
    var t = Date.parse(ev.TimeStamp) || 0, name = ev.Victim && ev.Victim.Name;
    return state.builds.some(function (b) { return b.kills && Object.keys(b.kills).some(function (j) { var k = b.kills[j]; return k && k.time === t && k.victim && k.victim.name === name; }); });
  }
  function renderKillboard() {
    var box = $('#kb'), g = state.prefs.kbGuild, gid = g && g.id;
    var head = g
      ? '<div class="kb-guild"><span class="kb-gname">' + esc((g.alliance ? '[' + g.alliance + '] ' : '') + g.name) + '</span><span class="kb-srv">' + esc(SERVERS[state.prefs.server]) + '</span>' +
        '<button type="button" class="btn sm" data-kb="change">Cambiar gremio</button><button type="button" class="btn sm" data-kb="refresh"' + (kb.loading ? ' disabled' : '') + '>Actualizar</button>' +
        (kb.at ? '<span class="kb-at">Actualizado ' + esc(relTime(kb.at)) + '</span>' : '') + '</div>'
      : '';
    var picker = !g || kb.found
      ? '<form class="kb-search" data-kb-form><label class="bt-lab" for="kb-q">Gremio del killboard</label><div class="bt-row"><input class="pk-q" id="kb-q" type="search" autocomplete="off" placeholder="Nombre del gremio o de un jugador del gremio" value="' + esc(kb.lastQ || state.prefs.guild || '') + '">' +
        '<button class="btn primary" type="submit"' + (kb.searching ? ' disabled' : '') + '>' + (kb.searching ? 'Buscando…' : 'Buscar') + '</button></div>' +
        (kb.found ? (kb.found.length ? '<div class="kb-found">' + kb.found.map(function (x, i) { return '<button type="button" class="chip" data-kb="pick" data-i="' + i + '">' + esc((x.alliance ? '[' + x.alliance + '] ' : '') + x.name) + (x.via ? ' <small>(' + esc(x.via) + ')</small>' : '') + '</button>'; }).join('') + '</div>'
          : '<p class="hint">No encontré gremios con ese nombre en ' + esc(SERVERS[state.prefs.server]) + '. Prueba con una sola palabra del nombre, el nombre de un miembro, o cambia el servidor en el cofre.</p>') : '') + '</form>'
      : '';
    var tools = g ? '<div class="kb-tools"><div class="mtabs kb-filter" role="group" aria-label="Filtrar">' + [['all', 'Todo'], ['deaths', 'Muertes'], ['kills', 'Kills']].map(function (f) {
      return '<button type="button" class="mtab" data-kb="filter" data-f="' + f[0] + '" aria-pressed="' + (kb.filter === f[0]) + '">' + f[1] + '</button>'; }).join('') + '</div>' +
      '<input class="pk-q" id="kb-player" type="search" autocomplete="off" placeholder="Filtrar por jugador" value="' + esc(kb.q) + '" aria-label="Filtrar por jugador"></div>' : '';
    var list = '';
    if (g) {
      var q = kb.q.trim().toLowerCase();
      var rows = kb.events.filter(function (ev) {
        var death = isDeath(ev, gid);
        if (kb.filter === 'deaths' && !death) return false;
        if (kb.filter === 'kills' && death) return false;
        if (q && ((ev.Killer && ev.Killer.Name) + ' ' + (ev.Victim && ev.Victim.Name)).toLowerCase().indexOf(q) < 0) return false;
        return true;
      });
      var nd = kb.events.filter(function (ev) { return isDeath(ev, gid); }).length;
      rows.sort(function (a, b) { return (Date.parse(b.TimeStamp) || 0) - (Date.parse(a.TimeStamp) || 0); });
      var sc = kb.scan && kb.scan.gid === gid ? kb.scan : null;
      var scanBox = '<div class="kb-scan">' + (sc && sc.running
        ? '<span>Buscando muertes: <b>' + sc.doneN + '</b> de <b>' + sc.total + '</b> miembros revisados' + (sc.fail ? ' · ' + sc.fail + ' sin respuesta' : '') + '…</span><button type="button" class="btn sm" data-kb="scan-stop">Detener</button>'
        : '<span>' + (sc && sc.finished ? 'Muertes revisadas ' + esc(relTime(sc.finished)) + (sc.fail ? ' · ' + sc.fail + ' miembros no respondieron' : '') + '. ' : 'La API oficial solo entrega las kills del gremio; las muertes se buscan miembro por miembro. ') + '</span>' +
          '<button type="button" class="btn sm' + (sc && sc.finished ? '' : ' primary') + '" data-kb="scan">' + (sc && sc.finished ? 'Buscar muertes nuevas' : 'Buscar muertes de los miembros') + '</button>') + '</div>';
      list = scanBox + (kb.events.length ? '<p class="kb-sum"><b>' + kb.events.length + '</b> eventos · <b class="down">' + nd + '</b> muertes · <b class="up">' + (kb.events.length - nd) + '</b> kills</p>' : '') +
        (rows.length ? '<ul class="kb-list">' + rows.map(function (ev) {
          var death = isDeath(ev, gid), added = death && kbAlreadyAdded(ev);
          return '<li class="kb-row ' + (death ? 'death' : 'kill') + '"><span class="kb-type">' + (death ? 'Muerte' : 'Kill') + '<small>' + esc(relTime(Date.parse(ev.TimeStamp) || 0)) + '</small></span>' +
            kbSide(ev.Killer, gid) + '<span class="kb-arrow" aria-hidden="true">›</span>' + kbSide(ev.Victim, gid) +
            '<span class="kb-fame">' + fmt.format(Math.round(ev.TotalVictimKillFame || 0)) + '<small>fama</small></span>' +
            '<span class="kb-acts"><button type="button" class="btn sm" data-kb="view" data-ev="' + ev.EventId + '">Ver equipo</button>' +
            (death ? '<button type="button" class="btn sm' + (added ? '' : ' primary') + '" data-kb="regear" data-ev="' + ev.EventId + '"' + (added ? ' disabled' : '') + '>' + (added ? 'En el regear' : 'Al regear') + '</button>' : '') + '</span></li>';
        }).join('') + '</ul>' : (kb.loading ? '' : '<p class="empty">' + (kb.events.length ? 'Nada con ese filtro.' : (kb.err ? '' : 'Sin eventos recientes para este gremio.')) + '</p>')) +
        (kb.err ? '<p class="status err">' + esc(kb.err) + '</p>' : '') +
        (kb.loading ? '<p class="hint kb-loading">Consultando la API de Albion… puede tardar hasta un minuto si está lenta.</p>' : '') +
        (kb.events.length && !kb.done && !kb.loading ? '<button type="button" class="btn kb-more" data-kb="more">Cargar más</button>' : '');
    }
    box.innerHTML = '<p class="hint">Kills y muertes recientes de tu gremio según la API oficial de Albion. «Al regear» agrega esa muerte a tus builds con el equipo con que murió. Para una pelea completa, usa «Importar pelea».</p>' + head + picker + tools + list;
    wireIcons(box);
    if (g && !kb.events.length && !kb.loading && !kb.err && kb.gid !== gid) kbLoad(true);
  }
  async function kbLoad(reset) {
    var g = state.prefs.kbGuild;
    if (!g || kb.loading) return;
    if (reset) { kb.events = kb.events.filter(function (e) { return e._death && kb.gid === g.id; }); kb.offset = 0; kb.done = false; }
    kb.gid = g.id; kb.loading = true; kb.err = ''; renderKillboard();
    try {
      await detectProxy();
      if (!proxyOn) throw new Error('sin puente');
      var page = await getJson(apiBase(state.prefs.server) + '/events?limit=' + KB_PAGE + '&offset=' + kb.offset + '&guildId=' + encodeURIComponent(g.id));
      if (state.prefs.kbGuild !== g) return;
      var seen = {}; kb.events.forEach(function (e) { seen[e.EventId] = 1; });
      (Array.isArray(page) ? page : []).forEach(function (e) { if (e && e.EventId && !seen[e.EventId]) kb.events.push(e); });
      kb.offset += KB_PAGE;
      kb.done = !Array.isArray(page) || page.length < KB_PAGE || kb.offset >= 1000;
      kb.at = Date.now();
    } catch (e) {
      kb.err = e && e.message === 'sin puente'
        ? 'Para el killboard hace falta el puente hacia la API de Albion (la página publicada en Vercel ya lo trae; en local usa «npm start»).'
        : 'La API de Albion no respondió (' + (e && e.message || 'sin conexión') + '). Pulsa «Actualizar» en un momento.';
    } finally {
      kb.loading = false;
      if (state.prefs.mode === 'killboard') renderKillboard();
    }
  }
  async function kbScanDeaths() {
    var g = state.prefs.kbGuild;
    if (!g || (kb.scan && kb.scan.running)) return;
    var sc = kb.scan = { gid: g.id, running: true, doneN: 0, total: 0, fail: 0, stop: false, finished: 0 };
    renderKillboard();
    var tick = setInterval(function () {
      var ae = document.activeElement; // no se repinta mientras se escribe en un campo del killboard
      if (state.prefs.mode === 'killboard' && !(ae && ae.closest && ae.closest('#kb input'))) renderKillboard();
    }, 1500);
    try {
      await detectProxy();
      if (!proxyOn) throw new Error('sin puente');
      var base = apiBase(state.prefs.server), members = await getJson(base + '/guilds/' + encodeURIComponent(g.id) + '/members');
      var cache = dfCache(g.id), first = !Object.keys(cache).length, since = Date.now() - KB_DEATH_DAYS * 864e5;
      var todo = (Array.isArray(members) ? members : []).filter(function (m) { return m && m.Id && (m.DeathFame || 0) > 0 && (first || cache[m.Id] !== m.DeathFame); });
      sc.total = todo.length;
      var seen = {}; kb.events.forEach(function (e) { seen[e.EventId] = e; });
      var i = 0;
      async function worker() {
        while (i < todo.length && !sc.stop) {
          var m = todo[i++], list = null;
          for (var a = 0; a < 2 && !list; a++) {
            try { var r = await fetch(base + '/players/' + encodeURIComponent(m.Id) + '/deaths', proxyInit(base)); if (r.ok) list = await r.json(); } catch (e) { /* se reintenta una vez */ }
          }
          if (!Array.isArray(list)) { sc.fail++; sc.doneN++; continue; }
          cache[m.Id] = m.DeathFame;
          list.forEach(function (ev) {
            if (!ev || !ev.EventId || (Date.parse(ev.TimeStamp) || 0) < since) return;
            if (seen[ev.EventId]) { seen[ev.EventId]._death = true; return; }
            ev._death = true; seen[ev.EventId] = ev; kb.events.push(ev);
          });
          sc.doneN++;
        }
      }
      await Promise.all([worker(), worker(), worker(), worker(), worker(), worker()]);
      dfSave(g.id, cache);
      sc.finished = Date.now();
      if (!sc.total) flash('#top-status', first ? 'Ningún miembro tiene muertes registradas.' : 'No hay muertes nuevas desde la última revisión.', 6000);
    } catch (e) {
      kb.err = 'No se pudieron buscar las muertes: ' + (e && e.message === 'sin puente' ? 'falta el puente hacia la API de Albion.' : (e && e.message || 'sin conexión') + '.');
    } finally {
      clearInterval(tick); sc.running = false;
      if (state.prefs.mode === 'killboard') renderKillboard();
    }
  }
  async function kbSearch(q) {
    q = q.trim();
    if (q.length < 3) { kb.err = ''; kb.found = []; renderKillboard(); return; }
    kb.searching = true; kb.lastQ = q; renderKillboard();
    try {
      await detectProxy();
      if (!proxyOn) throw new Error('sin puente');
      // La búsqueda de la API es irregular con espacios: se prueba %20, «+» y, si no hay nada, la palabra más larga.
      var base = apiBase(state.prefs.server) + '/search?q=', out = [], ids = {}, r = { guilds: [], players: [] };
      var tries = [encodeURIComponent(q)], longest = q.split(/\s+/).sort(function (a, b) { return b.length - a.length; })[0];
      if (/\s/.test(q)) tries.push(q.split(/\s+/).map(encodeURIComponent).join('+'));
      if (longest && longest !== q && longest.length >= 3) tries.push(encodeURIComponent(longest));
      for (var t = 0; t < tries.length; t++) {
        var part = await getJson(base + tries[t]).catch(function () { return {}; });
        r.guilds = r.guilds.concat(part.guilds || []); r.players = r.players.concat(part.players || []);
        if (r.guilds.length && t >= Math.min(1, tries.length - 1)) break;
      }
      var lq = q.toLowerCase();
      r.guilds.sort(function (a, b) { return (String(b.Name).toLowerCase() === lq) - (String(a.Name).toLowerCase() === lq); });
      (r.guilds || []).forEach(function (x) { if (x.Id && !ids[x.Id]) { ids[x.Id] = 1; out.push({ id: x.Id, name: x.Name, alliance: x.AllianceName || '' }); } });
      // Si se buscó a un jugador, se ofrece su gremio.
      (r.players || []).forEach(function (x) { if (x.GuildId && !ids[x.GuildId]) { ids[x.GuildId] = 1; out.push({ id: x.GuildId, name: x.GuildName, alliance: x.AllianceName || '', via: 'gremio de ' + x.Name }); } });
      kb.found = out.slice(0, 12);
    } catch (e) {
      kb.found = null;
      kb.err = 'No se pudo buscar el gremio: ' + (e && e.message === 'sin puente' ? 'falta el puente hacia la API de Albion.' : (e && e.message || 'sin conexión') + '.');
    } finally { kb.searching = false; renderKillboard(); }
  }
  function kbRegear(ev) {
    var v = ev.Victim, gear = gearFrom(v && v.Equipment);
    if (!hasGear(gear)) { flash('#top-status', 'Esa muerte no tiene equipo para regear.', 6000); return; }
    var kill = cleanKill(killInfo(ev)), key = JSON.stringify(gear.slots);
    // Si ya hay una build con exactamente el mismo equipo, se suma el jugador a esa build.
    var same = state.builds.filter(function (b) { return JSON.stringify(Object.keys(b.slots).sort().reduce(function (o, k) { var it = b.slots[k]; o[k] = { key: it.key, tier: it.tier, ench: it.ench, qty: it.qty }; return o; }, {})) === JSON.stringify(Object.keys(gear.slots).sort().reduce(function (o, k) { o[k] = gear.slots[k]; return o; }, {})); })[0];
    if (same) {
      var j = same.players; same.players = Math.min(99, same.players + 1);
      same.members = (same.members || []).slice(0, j); while (same.members.length < j) same.members.push('');
      same.members.push(v.Name);
      if (kill) { same.kills = same.kills || {}; same.kills[j] = kill; }
    } else {
      var w = gear.slots.weapon, name = w ? nameOf(byKey.get(w.key), w.tier) + ' ' + tagText(w.tier, w.ench) : 'Build';
      state.builds.push(cleanBuild({ name: name, role: guessRole(gear.slots), players: 1, slots: gear.slots, members: [v.Name], kills: kill ? { 0: kill } : undefined }));
    }
    kb.added[ev.EventId] = 1;
    save(); renderAll();
    flash('#top-status', 'Se agregó a ' + v.Name + ' al regear' + (same ? ' (build «' + same.name + '»)' : '') + (gear.unknown.length ? ' · ' + gear.unknown.length + ' items no reconocidos' : '') + '.', 7000);
  }
  $('#kb').addEventListener('submit', function (ev) {
    if (!ev.target.closest('[data-kb-form]')) return;
    ev.preventDefault(); kb.err = ''; kbSearch($('#kb-q').value);
  });
  $('#kb').addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-kb]');
    if (!b) return;
    var a = b.dataset.kb, e = a === 'view' || a === 'regear' ? kb.events.filter(function (x) { return String(x.EventId) === b.dataset.ev; })[0] : null;
    if (a === 'change') { kb.found = []; kb.err = ''; renderKillboard(); var qi = $('#kb-q'); if (qi) qi.focus(); }
    else if (a === 'pick') {
      var x = kb.found[+b.dataset.i];
      state.prefs.kbGuild = { id: x.id, name: x.name, alliance: x.alliance }; save();
      kb.found = null; kb.events = []; kb.gid = null; kb.err = ''; if (kb.scan) kb.scan.stop = true; kb.scan = null; kbLoad(true);
    }
    else if (a === 'refresh') kbLoad(true);
    else if (a === 'scan') kbScanDeaths();
    else if (a === 'scan-stop') { if (kb.scan) kb.scan.stop = true; }
    else if (a === 'more') kbLoad(false);
    else if (a === 'filter') { kb.filter = b.dataset.f; renderKillboard(); }
    else if (a === 'view' && e) openKill({ kill: killInfo(e) });
    else if (a === 'regear' && e) kbRegear(e);
  });
  $('#kb').addEventListener('input', function (ev) {
    if (ev.target.id !== 'kb-player') return;
    kb.q = ev.target.value;
    var pos = ev.target.selectionStart; renderKillboard();
    var el = $('#kb-player'); el.focus(); try { el.setSelectionRange(pos, pos); } catch (e2) { /* sin cursor */ }
  });

  /* ---------- Ver quién lo mató ---------- */
  var KILL_GRID = [['Bag', 'Head', 'Cape'], ['MainHand', 'Armor', 'OffHand'], ['Potion', 'Shoes', 'Food'], [null, 'Mount', null]];
  function typeInfo(type) {
    var m = /^T(\d)_(.+?)(?:@(\d))?$/.exec(type || ''), def = m && byKey.get(m[2]);
    if (def) return { name: nameOf(def, +m[1]), tag: tagText(+m[1], +(m[3] || 0)) };
    return { name: (REC.N && REC.N[type]) || 'Item', tag: m ? tagText(+m[1], +(m[3] || 0)) : '' };
  }
  function kgCell(type, count) {
    var ti = typeInfo(type);
    return '<span class="kg-cell" title="' + esc(ti.name + (ti.tag ? ' ' + ti.tag : '')) + '">' + iconHtml(type, ti.name) + (ti.tag ? '<span class="kg-tag">' + esc(ti.tag) + '</span>' : '') + (count > 1 ? '<span class="kg-n">' + count + '</span>' : '') + '</span>';
  }
  function kgSide(title, cls, p) {
    var rows = KILL_GRID.map(function (row) {
      return '<div class="kg-row">' + row.map(function (k) { return k && p.eq[k] ? kgCell(p.eq[k].Type, 1) : '<span class="kg-cell empty"></span>'; }).join('') + '</div>';
    }).join('');
    return '<div class="kg-side"><h3 class="kg-t ' + cls + '">' + title + '</h3><div class="kg-guild">' + (p.guild ? (p.alliance ? '[' + esc(p.alliance) + '] ' : '') + esc(p.guild) : 'Sin gremio') + '</div>' +
      '<div class="kg-name">' + esc(p.name) + '</div><div class="kg-ip">' + (p.ip ? fmt.format(p.ip) + ' IP' : '') + '</div>' + rows + '</div>';
  }
  function openKill(e) {
    var k = e.kill;
    if (!k || !k.killer || !k.victim) return;
    var time = k.time ? new Date(k.time).toLocaleString('es-CL') : '';
    $('#kill-body').innerHTML = '<p class="kg-sum">' + esc(k.victim.name) + ' murió a manos de <b>' + esc(k.killer.name) + '</b>' + (time ? ' · ' + esc(time) : '') + (k.fame ? ' · ' + fmt.format(k.fame) + ' fama' : '') + '</p>' +
      '<div class="kg-cols">' + kgSide('Asesino', 'killer', k.killer) + kgSide('Víctima', 'victim', k.victim) + '</div>' +
      '<h3 class="kg-inv-t">Inventario de la víctima</h3>' + (k.inv.length ? '<div class="kg-inv">' + k.inv.map(function (i) { return kgCell(i.Type, i.Count); }).join('') + '</div>' : '<p class="empty">Sin inventario registrado.</p>');
    wireIcons($('#kill-body'));
    $('#kill-modal').hidden = false;
    $('#kill-modal [data-kill-close]').focus();
  }
  function closeKill() { $('#kill-modal').hidden = true; }
  $('#kill-modal').addEventListener('click', function (ev) { if (ev.target.id === 'kill-modal' || ev.target.closest('[data-kill-close]')) closeKill(); });

  function openBattle(opener) {
    bt.opener = opener || null;
    $('#bt-modal').hidden = false;
    document.documentElement.classList.add('lock');
    renderBattle();
    detectProxy().then(function () { if (!$('#bt-modal').hidden && !bt.data) renderBattle(); });
    $('#bt-ids').focus();
  }
  function closeBattle() {
    $('#bt-modal').hidden = true;
    document.documentElement.classList.remove('lock');
    if (bt.opener) bt.opener.focus();
  }

  $('#bt-server').innerHTML = Object.keys(SERVERS).map(function (k) { return '<option value="' + k + '">' + SERVERS[k] + '</option>'; }).join('');
  $('#bt-open').addEventListener('click', function () { openBattle(this); });
  $('#bt-go').addEventListener('click', searchBattle);
  $('#bt-ids').addEventListener('keydown', function (ev) { if (ev.key === 'Enter') searchBattle(); });
  $('#bt-server').addEventListener('change', function (ev) { setServer(ev.target.value); });
  $('#bt-paste-go').addEventListener('click', usePasted);
  $('#bt-add').addEventListener('click', importSelected);
  $('#bt-modal').addEventListener('click', function (ev) {
    var kb = ev.target.closest('[data-kill]');
    if (kb) { openKill(bt.entries[+kb.dataset.kill]); return; }
    if (ev.target.id === 'bt-modal' || ev.target.closest('[data-bt="close"]')) { closeBattle(); return; }
    var b = ev.target.closest('[data-bt="all"],[data-bt="none"]');
    if (!b) return;
    var on = b.dataset.bt === 'all';
    bt.entries.forEach(function (e) { bt.sel[e.uid] = on; });
    document.querySelectorAll('#bt-body .bt-sel').forEach(function (c) { c.checked = on; });
    updateBtFoot();
  });
  $('#bt-modal').addEventListener('change', function (ev) {
    var t = ev.target;
    if (t.name === 'bt-mode') { $('#bt-add').textContent = t.value === 'kills' ? 'Agregar muertes' : 'Crear builds'; }
    else if (t.classList.contains('bt-sel')) { bt.sel[bt.entries[+t.dataset.i].uid] = t.checked; updateBtFoot(); }
    else if (t.classList.contains('bt-role')) { bt.role[bt.entries[+t.dataset.i].uid] = t.value; updateBtFoot(); }
    else if (t.id === 'bt-guild') { bt.guild = t.value; if (t.value) { state.prefs.guild = t.value; save(); } renderBattle(); }
    else if (t.id === 'bt-seen') { bt.includeSeen = t.checked; renderBattle(); }
  });

  /* ---------- Selector de items ---------- */
  var picker = null, lastFocus = null;
  function pickerDefs() {
    var t = state.prefs.tier, e = state.prefs.ench, q = plain(picker.q.trim());
    return DEFS.filter(function (d) {
      return d.slot === picker.slot && hasTier(d, t) && hasEnch(d, e) &&
        (!q || plain(nameOf(d, t)).indexOf(q) >= 0 || plain(pickName(d.nameEn, t)).indexOf(q) >= 0);
    });
  }
  function renderPickerChips() {
    var union = 0;
    DEFS.forEach(function (d) { if (d.slot === picker.slot) union |= d.tiers; });
    var tiers = [];
    for (var t = 1; t <= 8; t++) if ((union >> t) & 1) tiers.push(t);
    $('#pk-tiers').innerHTML = '<span class="lab">Tier</span>' + tiers.map(function (t) {
      return '<button type="button" class="chip" data-tier="' + t + '" aria-pressed="' + (state.prefs.tier === t) + '">T' + t + '</button>';
    }).join('');
    var cur = state.prefs.tier, ench = '<span class="lab">Encant.</span>';
    for (var e = 0; e <= 4; e++) {
      var any = DEFS.some(function (d) { return d.slot === picker.slot && hasTier(d, cur) && hasEnch(d, e); });
      ench += '<button type="button" class="chip" data-ench="' + e + '" aria-pressed="' + (state.prefs.ench === e) + '"' + (any ? '' : ' disabled') + '>.' + e + '</button>';
    }
    $('#pk-ench').innerHTML = ench;
  }
  function renderPickerList() {
    var t = state.prefs.tier, e = state.prefs.ench, list = pickerDefs(), host = $('#pk-list');
    if (!list.length) {
      host.innerHTML = '<li class="pk-none">No hay items para ' + tagText(t, e) + (picker.q ? ' con esa búsqueda' : '') + '. Prueba otro tier o encantamiento.</li>';
      return;
    }
    host.innerHTML = list.map(function (d) {
      var nm = nameOf(d, t);
      return '<li><button type="button" class="pk-item" data-key="' + esc(d.key) + '">' + iconHtml(itemId(d.key, t, e), nm, true) +
        '<span class="pk-txt"><span class="pk-name">' + esc(nm) + (d.two ? ' <span class="two">2H</span>' : '') + '</span><span class="pk-key">' + tagText(t, e)  + '</span></span></button></li>';
    }).join('');
    wireIcons(host);
    host.scrollTop = 0;
  }
  function openPicker(buildId, slot, opener) {
    picker = { buildId: buildId, slot: slot, q: '' };
    lastFocus = opener || null;
    $('#pk-title').textContent = 'Elegir · ' + SLOT_LABEL[slot];
    $('#pk-q').value = '';
    renderPickerChips(); renderPickerList();
    $('#picker').hidden = false;
    document.documentElement.classList.add('lock');
    $('#pk-q').focus();
  }
  function closePicker(restore) {
    $('#picker').hidden = true;
    document.documentElement.classList.remove('lock');
    var p = picker; picker = null;
    if (restore && p) {
      var btn = document.querySelector('button[data-action="pick"][data-build="' + p.buildId + '"][data-slot="' + p.slot + '"]');
      if (btn) btn.focus();
    }
  }
  function choose(key) {
    var b = getBuild(picker.buildId), def = byKey.get(key), prev = b.slots[picker.slot];
    b.slots[picker.slot] = { key: key, tier: state.prefs.tier, ench: state.prefs.ench, qty: prev ? prev.qty : 1 };
    if (picker.slot === 'weapon' && def.two) delete b.slots.offhand;
    save(); renderAll(); closePicker(true);
  }

  /* ---------- Eventos ---------- */
  $('#builds').addEventListener('click', function (ev) {
    var el = ev.target.closest('[data-action]');
    if (!el) return;
    var act = el.dataset.action, id = el.dataset.build, b = getBuild(id);
    if (!b) return;
    if (act === 'p-kill') {
      var kj = +el.dataset.j;
      if (b.kills && b.kills[kj]) openKill({ kill: b.kills[kj] });
      return;
    }
    if (act === 'p-all' || act === 'p-slot') {
      var j = +el.dataset.j, slots = itemSlots(b), full = slots.length && slots.every(function (sl) { return isDenied(b, j, sl); });
      if (act === 'p-all') setDeny(b, j, full ? [] : ['all']); else toggleSlot(b, j, el.dataset.slot);
      save(); renderAll();
      return;
    }
    if (act !== 'del' && armedDelete) { armedDelete = null; }
    if (act === 'pick') { openPicker(id, el.dataset.slot, el); return; }
    if (act === 'clear') { delete b.slots[el.dataset.slot]; }
    else if (act === 'inc') { b.players = clamp(b.players + 1, 1, 99); }
    else if (act === 'dec') { b.players = clamp(b.players - 1, 1, 99); }
    else if (act === 'dup') {
      var copy = cleanBuild(JSON.parse(JSON.stringify(b)));
      copy.name = (b.name + ' (copia)').slice(0, 60);
      listOf(b).splice(listOf(b).indexOf(b) + 1, 0, copy);
    } else if (act === 'del') {
      if (armedDelete !== id) { armedDelete = id; renderBuilds(); return; }
      armedDelete = null;
      listOf(b).splice(listOf(b).indexOf(b), 1);
    }
    save(); renderAll();
  });
  $('#builds').addEventListener('input', function (ev) {
    if (!ev.target.classList.contains('b-name')) return;
    var b = getBuild(ev.target.dataset.build);
    if (b) { b.name = ev.target.value.slice(0, 60); save(); $('#example-hint').hidden = state.prefs.mode === 'guides' || !state.builds.some(function (x) { return /^Ejemplo/.test(x.name); }); }
  });
  $('#builds').addEventListener('change', function (ev) {
    var t = ev.target, b = getBuild(t.dataset.build);
    if (!b) return;
    if (t.classList.contains('b-role')) {
      if (ROLE_IDS.indexOf(t.value) < 0) return;
      b.role = t.value; state.prefs.role = t.value; save(); renderAll();
      var moved = document.getElementById('role-' + b.id);
      if (moved) moved.focus();
      return;
    }
    if (t.classList.contains('pl-num')) b.players = clamp(parseInt(t.value, 10) || 1, 1, 99);
    else if (t.classList.contains('qty-in')) { var it = b.slots[t.dataset.slot]; if (it) it.qty = clamp(parseInt(t.value, 10) || 1, 1, 99); }
    else return;
    save(); renderAll();
  });
  $('#mode-tabs').addEventListener('click', function (ev) {
    var btn = ev.target.closest('[data-mode]');
    if (!btn || btn.dataset.mode === state.prefs.mode) return;
    armedDelete = null; state.prefs.mode = btn.dataset.mode; save(); renderBuilds();
  });
  $('#pl-q').addEventListener('input', function () { renderBuilds(); });
  $('#pl-allow').addEventListener('click', function () {
    state.builds.forEach(function (b) { delete b.deny; });
    save(); renderAll();
    flash('#top-status', 'Se permitieron todos los reequips.');
  });
  $('#role-tabs').addEventListener('click', function (ev) {
    var btn = ev.target.closest('[data-role]');
    if (!btn || btn.dataset.role === state.prefs.role) return;
    armedDelete = null;
    state.prefs.role = btn.dataset.role; save(); renderBuilds();
    var again = document.querySelector('#role-tabs [data-role="' + btn.dataset.role + '"]');
    if (again) again.focus();
  });
  // Botón de dos toques: el primero pide confirmar (los diálogos del navegador no funcionan dentro de Claude).
  function armed(btn, label, fn) {
    var orig = btn.textContent, timer = null;
    btn.addEventListener('click', function () {
      if (!timer) {
        btn.textContent = label; btn.classList.add('armed');
        timer = setTimeout(function () { timer = null; btn.textContent = orig; btn.classList.remove('armed'); }, 3500);
        return;
      }
      clearTimeout(timer); timer = null; btn.textContent = orig; btn.classList.remove('armed');
      fn();
    });
  }
  armed($('#clear-builds'), '¿Limpiar todas?', function () {
    var gm = state.prefs.mode === 'guides', n = curList().length;
    if (!n) { flash('#top-status', gm ? 'No hay guías que limpiar.' : 'No hay builds que limpiar.'); return; }
    if (gm) state.guides = []; else { state.builds = []; releaseTaken(); }
    armedDelete = null;
    save(); renderAll();
    flash('#top-status', gm ? n + (n === 1 ? ' guía eliminada.' : ' guías eliminadas.') : n + (n === 1 ? ' build eliminada' : ' builds eliminadas') + '. El stock y los precios se conservan.', 6000);
  });
  armed($('#regear-done'), '¿Descontar del stock?', function () {
    var used = 0, short = 0, rows = Array.from(totals().values());
    if (!rows.length) { flash('#top-status', 'No hay items en las builds.'); return; }
    rows.forEach(function (r) {
      var rest = r.need, sub = r.cov;
      consume(r, sub);
      used += sub + Math.min(takenOf(r.id), r.count);
      short += rest - sub;
    });
    var nb = state.builds.length;
    state.taken = {}; state.checked = {}; state.builds = []; armedDelete = null;
    save(); renderAll();
    flash('#top-status', 'Reequip listo: ' + used + ' items descontados del stock' + (short ? ' · ' + short + ' no estaban en stock' : '') + ' · ' + nb + (nb === 1 ? ' build limpiada' : ' builds limpiadas') + ' (las guías se conservan).', 8000);
  });
  $('#add').addEventListener('click', function () {
    var gm = state.prefs.mode === 'guides', b = cleanBuild({ name: (gm ? 'Guía ' : 'Build ') + (curList().length + 1), role: state.prefs.role, players: 1, slots: {} });
    curList().push(b); save(); renderAll();
    var inp = document.getElementById('name-' + b.id);
    if (inp) { inp.focus(); inp.select(); try { inp.scrollIntoView({ block: 'center' }); } catch (e) { /* sin scroll */ } }
  });

  // Stock: botones +/- y número editable, tanto en el cofre como en la pestaña Stock.
  function refocusStock(id, host) {
    var el = document.querySelector(host + ' .st-in[data-id="' + id + '"]');
    if (el) el.focus();
  }
  function onStockClick(host) {
    return function (ev) {
      var b = ev.target.closest('[data-st]');
      if (!b) return;
      var id = b.dataset.id, row = totals().get(id);
      if (row) setPool(row, poolOf(row) + (b.dataset.st === 'inc' ? 1 : -1)); else setStock(id, stockOf(id) + (b.dataset.st === 'inc' ? 1 : -1));
      save(); renderAll(); refocusStock(id, host);
    };
  }
  function onStockChange(host) {
    return function (ev) {
      var t = ev.target;
      if (!t.classList.contains('st-in')) return;
      var row = totals().get(t.dataset.id);
      if (row) setPool(row, t.value); else setStock(t.dataset.id, t.value);
      save(); renderAll(); refocusStock(t.dataset.id, host);
    };
  }
  $('#manifest-body').addEventListener('click', onStockClick('#manifest-body'));
  $('#manifest-body').addEventListener('change', onStockChange('#manifest-body'));

  $('#manifest-body').addEventListener('change', function (ev) {
    var t = ev.target;
    if (t.classList.contains('px-in')) {
      var v = Math.round(parseFloat(t.value));
      if (v > 0) state.prices[t.dataset.id] = v; else delete state.prices[t.dataset.id];
      save(); updateItemSilver(); updateSilver();
      return;
    }
    if (!t.classList.contains('chk')) return;
    var id = t.dataset.id, row = totals().get(id);
    if (t.checked) {
      state.checked[id] = true;
      var take = row ? row.cov : 0;
      if (take > 0) { state.taken[id] = takenOf(id) + take; consume(row, take); }
    } else {
      delete state.checked[id];
      if (takenOf(id)) { setStock(id, stockOf(id) + takenOf(id)); delete state.taken[id]; }
    }
    save(); renderAll();
    var again = document.querySelector('#manifest-body .chk[data-id="' + id + '"]');
    if (again) again.focus();
  });
  $('#clear-checks').addEventListener('click', function () { releaseTaken(); save(); renderAll(); flash('#m-status', 'Marcas limpiadas; lo sacado volvió al stock.'); });
  $('#copy').addEventListener('click', function () { copyText(manifestText(), $('#copy-fb'), '#m-status'); });

  $('#picker').addEventListener('click', function (ev) {
    if (ev.target.id === 'picker' || ev.target.closest('[data-pk="close"]')) { closePicker(true); return; }
    var tier = ev.target.closest('[data-tier]'), en = ev.target.closest('[data-ench]'), item = ev.target.closest('[data-key]');
    if (tier) { state.prefs.tier = +tier.dataset.tier; save(); renderPickerChips(); renderPickerList(); }
    else if (en && !en.disabled) { state.prefs.ench = +en.dataset.ench; save(); renderPickerChips(); renderPickerList(); }
    else if (item) choose(item.dataset.key);
  });
  $('#pk-q').addEventListener('input', function (ev) { picker.q = ev.target.value; renderPickerList(); });
  document.addEventListener('keydown', function (ev) {
    if (ev.key !== 'Escape') return;
    if (!$('#kill-modal').hidden) closeKill(); else if (picker) closePicker(true); else if (!$('#bt-modal').hidden) closeBattle();
  });

  document.querySelectorAll('.mbar .seg').forEach(function (btn) {
    btn.addEventListener('click', function () {
      $('#wrap').dataset.view = btn.dataset.view;
      document.querySelectorAll('.mbar .seg').forEach(function (o) { o.setAttribute('aria-pressed', String(o === btn)); });
      try { window.scrollTo({ top: 0 }); } catch (e) { /* sin scroll */ }
    });
  });

  /* Respaldo */
  $('#exp').addEventListener('click', function () {
    var json = JSON.stringify({ builds: state.builds, guides: state.guides }, null, 1);
    var ta = $('#json'); ta.value = json;
    var manual = function () { ta.focus(); ta.select(); flash('#b-status', 'Texto seleccionado: usa Ctrl+C.'); };
    try { navigator.clipboard.writeText(json).then(function () { flash('#b-status', 'JSON copiado.'); }, manual); } catch (e) { manual(); }
  });
  $('#imp').addEventListener('click', function () {
    var raw = $('#json').value.trim();
    if (!raw) { flash('#b-status', 'Pega primero el JSON en el cuadro.'); return; }
    try {
      var data = JSON.parse(raw);
      if (!data || !Array.isArray(data.builds)) throw new Error('forma');
      var clean = sanitize({ builds: data.builds, guides: data.guides || [], checked: state.checked, prefs: state.prefs });
      state.builds = clean.builds; if (Array.isArray(data.guides)) state.guides = clean.guides; save(); renderAll();
      flash('#b-status', clean.builds.length + ' builds y ' + state.guides.length + ' guías cargadas.');
    } catch (e) { flash('#b-status', 'JSON no válido. Copia el texto completo desde «Copiar JSON».'); }
  });

  /* Tema */
  var themeBtn = $('#theme');
  function currentTheme() {
    var a = document.documentElement.getAttribute('data-theme');
    if (a) return a;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  function themeLabel() { themeBtn.textContent = currentTheme() === 'dark' ? 'Modo claro' : 'Modo oscuro'; }
  var savedTheme = lsGet(LS_THEME);
  if (savedTheme === 'dark' || savedTheme === 'light') document.documentElement.setAttribute('data-theme', savedTheme);
  themeBtn.addEventListener('click', function () {
    var next = currentTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    lsSet(LS_THEME, next); themeLabel();
  });
  themeLabel();

  // La página de stock escribe en el mismo almacenamiento: al volver o al cambiar, se recarga el stock.
  function syncStock() { setTimeout(doSync, 0); }
  // Con la nube activa, otra pestaña también puede traer builds, guías o precios: se recarga todo menos las preferencias.
  function doSync() {
    var raw = lsGet(LS);
    if (raw === lastSeen) return;
    lastSeen = raw;
    var prefs = state.prefs, fresh = loadState();
    fresh.prefs = prefs; state = fresh; armedDelete = null;
    renderAll();
  }
  var lastSeen = lsGet(LS);
  window.addEventListener('storage', function (ev) { if (ev.key === LS) syncStock(); });
  // Datos nuevos desde la nube (cloud.js): se recarga todo menos las preferencias de este usuario.
  window.addEventListener('regear:remote', syncStock);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) syncStock(); });

  setServer(state.prefs.server);
  renderAll();
})();
