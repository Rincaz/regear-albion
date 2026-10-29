// Sincronización con Supabase: comparte builds, guías, precios, stock y movimientos entre los miembros de un gremio.
// La app sigue leyendo y escribiendo localStorage como siempre; este archivo:
//   1) detecta cada escritura de 'regear-albion-v1' y sube solo lo que cambió (el stock como sumas/restas atómicas),
//   2) baja los datos del gremio, los escribe en localStorage y avisa a la página con el evento 'regear:remote',
//   3) escucha cambios en tiempo real de los demás miembros.
// "Base" = lo que se sabe que hay en el servidor; es compartida entre pestañas para que ninguna suba un cambio dos veces.
(function () {
  'use strict';
  var CFG = window.REGEAR_CONFIG || {};
  var LS = 'regear-albion-v1', BASE = 'regear-albion-cloud-base', META = 'regear-albion-cloud', BACKUP = 'regear-albion-v1-local';
  var DOCS = ['builds', 'guides', 'prices', 'taken', 'checked', 'logSeen'];
  var SEP = '\u0001';
  var proto = Storage.prototype, rawSet = proto.setItem, rawGet = proto.getItem, rawDel = proto.removeItem;

  function get(k) { try { return rawGet.call(localStorage, k); } catch (e) { return null; } }
  function set(k, v) { try { rawSet.call(localStorage, k, v); return true; } catch (e) { return false; } }
  function del(k) { try { rawDel.call(localStorage, k); } catch (e) { /* sin almacenamiento */ } }
  function parse(s, d) { try { var v = JSON.parse(s); return v == null ? d : v; } catch (e) { return d; } }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function errText(e) { return (e && (e.message || e.error_description || e.details)) || String(e); }

  if (!CFG.supabaseUrl || !CFG.supabaseAnonKey) return; // Sin configurar: modo solo local.
  var bar = document.getElementById('cloud-bar');
  if (!bar) return;
  bar.hidden = false;
  if (!window.supabase || typeof window.supabase.createClient !== 'function') {
    bar.innerHTML = '<span class="cl-ico" aria-hidden="true">☁</span><span class="cl-st warn">Sin conexión con la nube: trabajas con los datos de este navegador.</span>';
    return;
  }
  var sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });

  /* ---------- Instantáneas comparables ---------- */
  // JSON con claves ordenadas: jsonb de Postgres reordena las claves, así que se compara siempre en esta forma.
  function canon(v) {
    if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
    if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ':' + canon(v[k]); }).join(',') + '}';
    return JSON.stringify(v === undefined ? null : v);
  }
  // El id de cada build se regenera al cargar la página: no forma parte de los datos compartidos.
  function normDoc(kind, v) {
    if (kind === 'builds' || kind === 'guides') return (Array.isArray(v) ? v : []).map(function (b) { var o = Object.assign({}, b); delete o.id; return o; });
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  }
  // Stock como celdas "item␁lugar" = cantidad; '' es «sin lugar» (el resto que no está asignado a un cofre).
  function cellsOf(st, loc) {
    var c = {};
    Object.keys(st || {}).forEach(function (id) {
      var tot = Math.round(+st[id]) || 0, m = (loc && loc[id]) || {}, placed = 0;
      if (tot <= 0) return;
      Object.keys(m).forEach(function (p) { var v = Math.round(+m[p]) || 0; if (p && v > 0) { c[id + SEP + p] = v; placed += v; } });
      if (tot - placed > 0) c[id + SEP] = tot - placed;
    });
    return c;
  }
  function fromCells(c) {
    var st = {}, loc = {};
    Object.keys(c).forEach(function (k) {
      var i = k.indexOf(SEP), id = k.slice(0, i), p = k.slice(i + 1), v = c[k];
      st[id] = (st[id] || 0) + v;
      if (p) (loc[id] = loc[id] || {})[p] = v;
    });
    return { stock: st, stockLoc: loc };
  }
  function moveRow(m) { return [String(m[0] || ''), String(m[1] || ''), String(m[2] || ''), Math.round(+m[3]) || 0, String(m[4] || '')]; }
  function moveSig(m) { return moveRow(m).join('|'); }
  function moveCounts(list) { var o = {}; (list || []).forEach(function (m) { var s = moveSig(m); o[s] = (o[s] || 0) + 1; }); return o; }
  function snapOf(raw) {
    var docs = {};
    DOCS.forEach(function (k) { docs[k] = canon(normDoc(k, raw[k])); });
    return { gid: gid, docs: docs, cells: cellsOf(raw.stock, raw.stockLoc), moves: moveCounts(raw.moves) };
  }
  function loadBase() { var b = parse(get(BASE), null); return b && b.gid === gid ? b : null; }
  function saveBase(b) { set(BASE, JSON.stringify(b)); }
  function isDirty() {
    var b = loadBase();
    if (!b || b.pending) return false;
    var cur = snapOf(parse(get(LS), {}));
    return canon(cur.docs) !== canon(b.docs) || canon(cur.cells) !== canon(b.cells) || canon(cur.moves) !== canon(b.moves);
  }

  /* ---------- Estado de sesión ---------- */
  var user = null, members = [], gid = null, role = null, channel = null;
  var meta = parse(get(META), {}) || {};
  var status = '', msg = '', ui = { panel: '' };
  var ownDirty = false, applying = false, pushTimer = null, pullTimer = null, pushing = null, waitForeign = 0;

  function saveMeta() { set(META, JSON.stringify(meta)); }
  function canEdit() { return role === 'admin' || role === 'editor'; }
  function current() { return members.filter(function (m) { return m.guild_id === gid; })[0] || null; }
  function setStatus(s) { status = s; var el = bar.querySelector('.cl-st'); if (el) { el.textContent = statusText(); el.className = 'cl-st ' + statusClass(); } }
  function statusText() {
    return { ok: 'Sincronizado', saving: 'Guardando…', loading: 'Cargando…', offline: 'Sin conexión: los cambios quedan aquí y se suben al volver', readonly: 'Solo lectura' }[status] || '';
  }
  function statusClass() { return status === 'offline' ? 'warn' : status === 'readonly' ? 'muted' : status === 'ok' ? 'good' : ''; }
  function note(text, ms) {
    msg = text; var el = bar.querySelector('.cl-msg'); if (el) el.textContent = text;
    clearTimeout(note.t); if (ms) note.t = setTimeout(function () { msg = ''; var e2 = bar.querySelector('.cl-msg'); if (e2) e2.textContent = ''; }, ms);
  }

  // Cada guardado de la página pasa por aquí: si el gremio está activo, se programa la subida.
  proto.setItem = function (k, v) {
    rawSet.call(this, k, v);
    if (this === window.localStorage && k === LS && gid && !applying) { ownDirty = true; schedulePush(); }
  };
  function schedulePush() {
    clearTimeout(pushTimer);
    if (!canEdit()) { pushTimer = setTimeout(function () { note('Tu rol es de solo lectura: los cambios no se guardan en el gremio.', 7000); pull(true); }, 400); return; }
    setStatus('saving');
    pushTimer = setTimeout(push, 500);
  }
  function schedulePull(delay) { clearTimeout(pullTimer); pullTimer = setTimeout(function () { pull(false); }, delay == null ? 700 : delay); }

  /* ---------- Subir ---------- */
  function chunks(a, n) { var out = []; for (var i = 0; i < a.length; i += n) out.push(a.slice(i, i + n)); return out; }
  async function push() {
    if (pushing) { await pushing; return push(); }
    var g = gid, ok = true;
    pushing = (async function () {
      var b = loadBase();
      if (!b || b.pending || !canEdit()) return; // pending: aún no se bajaron los datos del gremio, no se sube nada
      var raw = parse(get(LS), {}), cur = snapOf(raw), docs = [], changes = [], newMoves = [];
      DOCS.forEach(function (k) { if (cur.docs[k] !== b.docs[k]) docs.push({ guild_id: g, kind: k, data: normDoc(k, raw[k]), updated_at: new Date().toISOString(), updated_by: user.id }); });
      var keys = {};
      Object.keys(cur.cells).concat(Object.keys(b.cells)).forEach(function (k) { keys[k] = 1; });
      Object.keys(keys).forEach(function (k) {
        var d = (cur.cells[k] || 0) - (b.cells[k] || 0), i = k.indexOf(SEP);
        if (d) changes.push({ item: k.slice(0, i), place: k.slice(i + 1), delta: d });
      });
      var left = Object.assign({}, b.moves);
      (raw.moves || []).forEach(function (m) { var s = moveSig(m); if (left[s] > 0) left[s]--; else newMoves.push(moveRow(m)); });
      ownDirty = false;
      if (!docs.length && !changes.length && !newMoves.length) { setStatus('ok'); return; }
      // La base se actualiza antes de enviar: otra pestaña ya no volverá a subir estos mismos cambios.
      saveBase(cur);
      try {
        if (docs.length) { var r = await sb.from('guild_docs').upsert(docs); if (r.error) throw r.error; }
        for (var c of chunks(changes, 1000)) { var r2 = await sb.rpc('stock_apply', { p_guild: g, p_changes: c }); if (r2.error) throw r2.error; }
        for (var mv of chunks(newMoves, 500)) {
          var r3 = await sb.from('movements').insert(mv.map(function (m) { return { guild_id: g, ts: m[0].slice(0, 19), player: m[1].slice(0, 40), item_id: m[2].slice(0, 80), qty: m[3], place: m[4].slice(0, 40) }; }));
          if (r3.error) throw r3.error;
        }
        setStatus('ok');
      } catch (e) {
        ok = false;
        console.error('[cloud] Error al subir:', e);
        if (!navigator.onLine || /fetch|network/i.test(errText(e))) {
          saveBase(b); ownDirty = true; setStatus('offline'); // se reintenta al volver la conexión
        } else {
          note('No se pudo guardar en la nube: ' + errText(e), 9000);
          await pull(true, true);
        }
      }
    })();
    try { await pushing; } finally { pushing = null; }
    return ok;
  }

  /* ---------- Bajar ---------- */
  async function selectAll(q) {
    var out = [], from = 0, size = 1000;
    for (;;) {
      var r = await q().range(from, from + size - 1);
      if (r.error) throw r.error;
      out = out.concat(r.data || []);
      if (!r.data || r.data.length < size || out.length >= 20000) return out;
      from += size;
    }
  }
  async function pull(force, insidePush) {
    var g = gid;
    if (!g) return;
    var bb = loadBase();
    if (!bb || bb.pending) force = true; // todavía no hay copia del gremio: manda el servidor
    if (!force) {
      if (pushing) await pushing;
      if (ownDirty) { await push(); if (ownDirty) return; } // sin conexión: no se pisan los cambios locales
      else if (isDirty() && waitForeign < 5) { waitForeign++; return schedulePull(1000); } // otra pestaña aún está subiendo
    }
    waitForeign = 0;
    if (!insidePush && !status) setStatus('loading');
    try {
      var res = await Promise.all([
        sb.from('guild_docs').select('kind,data').eq('guild_id', g),
        selectAll(function () { return sb.from('stock').select('item_id,place,qty').eq('guild_id', g).order('item_id').order('place'); }),
        selectAll(function () { return sb.from('movements').select('ts,player,item_id,qty,place').eq('guild_id', g).order('ts', { ascending: false }).order('id', { ascending: false }); })
      ]);
      if (res[0].error) throw res[0].error;
      if (g !== gid) return;
      if (!force && ownDirty) return schedulePull(300); // se editó algo mientras llegaban los datos
      var raw = parse(get(LS), {}), docs = {};
      (res[0].data || []).forEach(function (d) { docs[d.kind] = d.data; });
      DOCS.forEach(function (k) { raw[k] = docs[k] !== undefined ? docs[k] : (k === 'builds' || k === 'guides' ? [] : {}); });
      var cells = {};
      res[1].forEach(function (s) { cells[s.item_id + SEP + (s.place || '')] = s.qty; });
      var st = fromCells(cells);
      raw.stock = st.stock; raw.stockLoc = st.stockLoc;
      raw.moves = res[2].slice(0, 5000).reverse().map(function (m) { return [m.ts, m.player, m.item_id, m.qty, m.place || '']; });
      var next = snapOf(raw), now = snapOf(parse(get(LS), {}));
      saveBase(next);
      ownDirty = false;
      setStatus('ok');
      // Si es el eco de nuestro propio cambio no se vuelve a pintar la página (no se pierde el foco al escribir).
      if (canon(next) === canon(now)) return;
      applying = true; set(LS, JSON.stringify(raw)); applying = false;
      window.dispatchEvent(new CustomEvent('regear:remote'));
    } catch (e) {
      applying = false;
      console.error('[cloud] Error al bajar datos:', e);
      setStatus('offline');
    }
  }

  /* ---------- Gremio ---------- */
  async function loadMembers() {
    var r = await sb.from('guild_members').select('guild_id,role,display_name,guilds(name,invite_code)').eq('user_id', user.id);
    if (r.error) throw r.error;
    members = (r.data || []).map(function (m) { return { guild_id: m.guild_id, role: m.role, display_name: m.display_name, name: m.guilds ? m.guilds.name : '?', invite: m.guilds ? m.guilds.invite_code : '' }; });
  }
  function hasLocalData(raw) { return raw && ((raw.builds && raw.builds.length) || (raw.guides && raw.guides.length) || (raw.stock && Object.keys(raw.stock).length)); }
  async function enterGuild(id) {
    leaveChannel();
    gid = id; meta.gid = id; saveMeta();
    var cur = current(); role = cur ? cur.role : null;
    note('');
    var b = parse(get(BASE), null);
    if (!b || b.gid !== id) {
      // Primera vez con este gremio en este navegador: se guarda una copia de los datos locales antes de reemplazarlos.
      var raw = parse(get(LS), {});
      if (!get(BACKUP) && hasLocalData(raw) && (!b || !b.gid)) set(BACKUP, get(LS));
      saveBase({ gid: id, pending: true, docs: {}, cells: {}, moves: {} });
      ownDirty = false;
      await pull(true);
    } else {
      ownDirty = isDirty(); // cambios hechos sin conexión en una sesión anterior
      await pull(false);
    }
    channel = sb.channel('guild-' + id);
    ['guild_docs', 'stock', 'movements'].forEach(function (t) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table: t, filter: 'guild_id=eq.' + id }, function () { schedulePull(); });
    });
    channel.on('postgres_changes', { event: '*', schema: 'public', table: 'guild_members', filter: 'guild_id=eq.' + id }, function () { refreshRole(); });
    channel.subscribe();
    render();
  }
  async function refreshRole() {
    try { await loadMembers(); } catch (e) { return; }
    var cur = current();
    if (!cur) { note('Ya no eres miembro de este gremio.', 9000); await exitGuild(); return; }
    role = cur.role; render();
    if (ui.panel === 'members') renderMembers();
  }
  function leaveChannel() { if (channel) { sb.removeChannel(channel); channel = null; } }
  // Al salir del gremio se vuelve a los datos locales que había antes de conectarse.
  async function exitGuild() {
    leaveChannel();
    gid = null; role = null; meta.gid = null; saveMeta();
    var back = get(BACKUP), raw = parse(get(LS), {}), local = parse(back, {});
    DOCS.concat(['stock', 'stockLoc', 'moves']).forEach(function (k) { if (local[k] !== undefined) raw[k] = local[k]; else delete raw[k]; });
    applying = true; set(LS, JSON.stringify(raw)); applying = false;
    del(BASE);
    window.dispatchEvent(new CustomEvent('regear:remote'));
    render();
  }

  /* ---------- Interfaz ---------- */
  function render() {
    var h = '<span class="cl-ico" aria-hidden="true">☁</span>';
    if (!user) {
      h += '<form class="cl-f" data-f="login"><label class="cl-lab">Compartir con tu gremio <input class="pk-q sm" type="email" name="email" required placeholder="tu@correo.com" autocomplete="email"></label>' +
        '<button class="btn sm primary" type="submit">Enviar enlace de acceso</button></form><span class="cl-st muted">Sin sesión: los datos solo están en este navegador.</span>';
    } else if (!gid || ui.panel === 'guilds') {
      h += '<span class="cl-who">' + esc(user.email || '') + '</span>' +
        (members.length ? '<select class="sel sm" data-a="pick" aria-label="Tus gremios"><option value="">Elegir gremio…</option>' + members.map(function (m) { return '<option value="' + esc(m.guild_id) + '"' + (m.guild_id === gid ? ' selected' : '') + '>' + esc(m.name) + ' · ' + m.role + '</option>'; }).join('') + '</select>' : '') +
        '<form class="cl-f" data-f="create"><input class="pk-q sm" name="name" required maxlength="60" placeholder="Nombre del gremio"><input class="pk-q sm" name="me" maxlength="40" placeholder="Tu nombre en el juego" value="' + esc(meta.me || '') + '"><button class="btn sm" type="submit">Crear gremio</button></form>' +
        '<form class="cl-f" data-f="join"><input class="pk-q sm" name="code" required maxlength="20" placeholder="Código de invitación"><input class="pk-q sm" name="me" maxlength="40" placeholder="Tu nombre en el juego" value="' + esc(meta.me || '') + '"><button class="btn sm" type="submit">Unirme</button></form>' +
        (gid ? '<button class="btn sm" type="button" data-a="back">Volver al gremio</button>' : '') +
        '<button class="btn sm" type="button" data-a="logout">Cerrar sesión</button>';
    } else {
      var cur = current() || {};
      h += '<b class="cl-g">' + esc(cur.name || 'Gremio') + '</b><span class="cl-role r-' + esc(role || '') + '">' + esc({ admin: 'Admin', editor: 'Editor', viewer: 'Solo lectura' }[role] || role || '') + '</span>' +
        '<span class="cl-st ' + statusClass() + '">' + esc(statusText()) + '</span>' +
        '<span class="cl-actions">' +
        '<button class="btn sm" type="button" data-a="invite" aria-expanded="' + (ui.panel === 'invite') + '">Invitar</button>' +
        '<button class="btn sm" type="button" data-a="members" aria-expanded="' + (ui.panel === 'members') + '">Miembros</button>' +
        (get(BACKUP) && canEdit() ? '<button class="btn sm" type="button" data-a="upload" title="Reemplaza los datos del gremio con los que tenías en este navegador antes de conectarte">Subir mis datos locales</button>' : '') +
        '<button class="btn sm" type="button" data-a="guilds">Otro gremio</button>' +
        '<button class="btn sm" type="button" data-a="logout">Cerrar sesión</button></span>';
      if (ui.panel === 'invite') {
        h += '<div class="cl-panel">Comparte este código: <code class="cl-code">' + esc(cur.invite || '') + '</code> <button class="btn sm" type="button" data-a="copy">Copiar</button>' +
          (role === 'admin' ? ' <button class="btn sm" type="button" data-a="rotate">Nuevo código</button>' : '') +
          '<span class="hint"> Quien entra con el código queda como «Solo lectura» hasta que un admin le cambie el rol.</span></div>';
      }
      if (ui.panel === 'members') h += '<div class="cl-panel" id="cl-members">Cargando miembros…</div>';
    }
    h += '<span class="cl-msg" role="status">' + esc(msg) + '</span>';
    bar.innerHTML = h;
    if (ui.panel === 'members' && gid) renderMembers();
  }
  async function renderMembers() {
    var box = bar.querySelector('#cl-members');
    if (!box) return;
    var r = await sb.from('guild_members').select('user_id,role,display_name').eq('guild_id', gid).order('joined_at');
    if (r.error) { box.textContent = 'No se pudieron cargar los miembros: ' + errText(r.error); return; }
    var admin = role === 'admin';
    box.innerHTML = '<ul class="cl-mem">' + r.data.map(function (m) {
      var me = m.user_id === user.id;
      return '<li><span>' + esc(m.display_name || 'Sin nombre') + (me ? ' (tú)' : '') + '</span>' +
        (admin && !me ? '<select class="sel sm" data-a="role" data-u="' + esc(m.user_id) + '">' + ['admin', 'editor', 'viewer'].map(function (x) { return '<option value="' + x + '"' + (x === m.role ? ' selected' : '') + '>' + { admin: 'Admin', editor: 'Editor', viewer: 'Solo lectura' }[x] + '</option>'; }).join('') + '</select>' +
          '<button class="btn sm danger" type="button" data-a="kick" data-u="' + esc(m.user_id) + '">Expulsar</button>' : '<span class="cl-role r-' + esc(m.role) + '">' + esc({ admin: 'Admin', editor: 'Editor', viewer: 'Solo lectura' }[m.role]) + '</span>') +
        (me && !admin ? '<button class="btn sm danger" type="button" data-a="leave">Salir del gremio</button>' : '') + '</li>';
    }).join('') + '</ul>';
  }

  bar.addEventListener('submit', async function (ev) {
    var f = ev.target.closest('form[data-f]');
    if (!f) return;
    ev.preventDefault();
    var fd = new FormData(f), btn = f.querySelector('button');
    btn.disabled = true;
    try {
      if (f.dataset.f === 'login') {
        var r = await sb.auth.signInWithOtp({ email: String(fd.get('email')).trim(), options: { emailRedirectTo: location.origin + location.pathname } });
        if (r.error) throw r.error;
        note('Te enviamos un enlace de acceso. Ábrelo en este mismo navegador.', 15000);
      } else {
        var me = String(fd.get('me') || '').trim().slice(0, 40);
        meta.me = me; saveMeta();
        var id;
        if (f.dataset.f === 'create') {
          var c = await sb.rpc('create_guild', { p_name: String(fd.get('name')).trim(), p_display: me });
          if (c.error) throw c.error;
          id = c.data.id;
        } else {
          var j = await sb.rpc('join_guild', { p_code: String(fd.get('code')).trim(), p_display: me });
          if (j.error) throw j.error;
          id = j.data;
        }
        await loadMembers();
        ui.panel = f.dataset.f === 'create' ? 'invite' : '';
        await enterGuild(id);
        if (f.dataset.f === 'create' && get(BACKUP)) note('Gremio creado. Usa «Subir mis datos locales» para llevar tus builds y stock actuales.', 12000);
      }
    } catch (e) {
      note(errText(e), 9000);
    } finally { btn.disabled = false; }
  });
  bar.addEventListener('change', async function (ev) {
    var t = ev.target;
    if (t.dataset.a === 'pick' && t.value) { ui.panel = ''; await enterGuild(t.value); }
    if (t.dataset.a === 'role') {
      var r = await sb.from('guild_members').update({ role: t.value }).eq('guild_id', gid).eq('user_id', t.dataset.u);
      note(r.error ? 'No se pudo cambiar el rol: ' + errText(r.error) : 'Rol actualizado.', 5000);
      renderMembers();
    }
  });
  var armedAt = {};
  function confirmTwice(key, btn, label) {
    if (armedAt[key] && Date.now() - armedAt[key] < 4000) { armedAt[key] = 0; return true; }
    armedAt[key] = Date.now(); var old = btn.textContent; btn.textContent = label;
    setTimeout(function () { if (btn.isConnected) btn.textContent = old; }, 4000);
    return false;
  }
  bar.addEventListener('click', async function (ev) {
    var b = ev.target.closest('button[data-a]');
    if (!b) return;
    var a = b.dataset.a;
    if (a === 'invite' || a === 'members') { ui.panel = ui.panel === a ? '' : a; render(); }
    else if (a === 'guilds') { ui.panel = 'guilds'; render(); }
    else if (a === 'back') { ui.panel = ''; render(); }
    else if (a === 'copy') {
      var code = (current() || {}).invite || '';
      try { await navigator.clipboard.writeText(code); note('Código copiado.', 4000); } catch (e) { note('Código: ' + code, 9000); }
    } else if (a === 'rotate') {
      if (!confirmTwice('rotate', b, '¿Invalidar el código actual?')) return;
      var r = await sb.rpc('rotate_invite', { p_guild: gid });
      if (r.error) { note(errText(r.error), 8000); return; }
      await loadMembers(); render();
    } else if (a === 'kick') {
      if (!confirmTwice('kick' + b.dataset.u, b, '¿Seguro?')) return;
      var k = await sb.from('guild_members').delete().eq('guild_id', gid).eq('user_id', b.dataset.u);
      note(k.error ? errText(k.error) : 'Miembro expulsado.', 5000); renderMembers();
    } else if (a === 'leave') {
      if (!confirmTwice('leave', b, '¿Salir del gremio?')) return;
      var l = await sb.from('guild_members').delete().eq('guild_id', gid).eq('user_id', user.id);
      if (l.error) { note(errText(l.error), 8000); return; }
      await loadMembers(); ui.panel = ''; await exitGuild();
    } else if (a === 'upload') {
      if (!confirmTwice('upload', b, '¿Reemplazar los datos del gremio?')) return;
      var raw = parse(get(LS), {}), local = parse(get(BACKUP), {});
      DOCS.concat(['stock', 'stockLoc', 'moves']).forEach(function (k) { if (local[k] !== undefined) raw[k] = local[k]; });
      applying = true; set(LS, JSON.stringify(raw)); applying = false;
      ownDirty = true;
      window.dispatchEvent(new CustomEvent('regear:remote'));
      setStatus('saving');
      if (await push()) { del(BACKUP); note('Tus datos locales se subieron al gremio.', 8000); render(); }
    } else if (a === 'logout') {
      if (gid) await exitGuild();
      await sb.auth.signOut();
      user = null; members = []; ui.panel = ''; render();
    }
  });

  window.addEventListener('online', function () { if (gid) schedulePull(100); });
  window.addEventListener('offline', function () { if (gid) setStatus('offline'); });
  document.addEventListener('visibilitychange', function () { if (!document.hidden && gid) schedulePull(200); });

  async function onSession(session) {
    var u = session ? session.user : null;
    if ((u && u.id) === (user && user.id)) return;
    user = u;
    if (!user) { leaveChannel(); gid = null; role = null; render(); return; }
    try {
      await loadMembers();
      var want = meta.gid && members.some(function (m) { return m.guild_id === meta.gid; }) ? meta.gid : (members.length === 1 ? members[0].guild_id : null);
      if (want) await enterGuild(want); else render();
    } catch (e) {
      console.error('[cloud]', e);
      setStatus('offline'); render();
    }
  }
  render();
  sb.auth.getSession().then(function (r) { onSession(r.data && r.data.session); });
  sb.auth.onAuthStateChange(function (_ev, session) { setTimeout(function () { onSession(session); }, 0); });
})();
