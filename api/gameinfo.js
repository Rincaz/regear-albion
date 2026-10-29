// Función de Vercel: puente hacia la API gameinfo de Albion, que no envía cabeceras CORS.
// vercel.json reescribe /gameinfo/<west|east|europe>/api/gameinfo/... a esta función (mismo origen, sin CORS).
const HOSTS = { west: 'gameinfo.albiononline.com', east: 'gameinfo-sgp.albiononline.com', europe: 'gameinfo-ams.albiononline.com' };

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return send(res, 405, { error: 'Método no permitido' });
  // La ruta llega en ?path= (rewrite de vercel.json); si no, se toma de la URL original.
  const raw = req.query.path;
  let path = (Array.isArray(raw) ? raw.join('/') : String(raw || '')).replace(/^\/+/, '');
  if (!path) path = decodeURIComponent(String(req.url || '').split('?')[0]).replace(/^\/(api\/)?gameinfo\/?/, '');
  if (path === 'ping') return send(res, 200, { ok: true });

  const m = /^(west|east|europe)\/(api\/gameinfo\/[A-Za-z0-9_\-/]*)$/.exec(path);
  if (!m) return send(res, 403, { error: 'Solo se permite /api/gameinfo/' });

  // Se reenvían los parámetros de la consulta (offset, limit...) menos el de la ruta.
  const qs = new URLSearchParams();
  Object.keys(req.query).forEach((k) => {
    if (k === 'path') return;
    [].concat(req.query[k]).forEach((v) => qs.append(k, v));
  });
  const target = 'https://' + HOSTS[m[1]] + '/' + m[2] + (qs.toString() ? '?' + qs : '');
  try {
    const up = await fetch(target, { headers: { 'user-agent': 'regear-albion/1.0', accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
    const text = await up.text();
    res.statusCode = up.status;
    res.setHeader('content-type', up.headers.get('content-type') || 'application/json');
    res.setHeader('cache-control', 'no-store');
    res.end(text);
  } catch (err) {
    console.error('[gameinfo]', target, err);
    send(res, 502, { error: err && err.name === 'TimeoutError' ? 'La API de Albion tardó demasiado en responder' : String(err && err.message || err) });
  }
};
