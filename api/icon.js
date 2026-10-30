// Función de Vercel (temporal, para generar las huellas de iconos): reenvía render.albiononline.com con CORS abierto.
module.exports = async function handler(req, res) {
  const id = String(req.query.id || '');
  if (!/^T[0-9]_[A-Za-z0-9_]+(@[0-9])?$/.test(id)) { res.statusCode = 400; return res.end('id no valido'); }
  try {
    const up = await fetch('https://render.albiononline.com/v1/item/' + id + '.png?size=64&quality=1', { signal: AbortSignal.timeout(15000) });
    const buf = Buffer.from(await up.arrayBuffer());
    res.statusCode = up.status;
    res.setHeader('content-type', up.headers.get('content-type') || 'image/png');
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('cache-control', 'public, max-age=86400');
    res.end(buf);
  } catch (e) { res.statusCode = 502; res.end(String(e && e.message || e)); }
};
