// Servidor local sin dependencias: sirve esta carpeta y hace de puente hacia la API de Albion.
// La API gameinfo no envía cabeceras CORS, así que el navegador no deja leer sus respuestas desde una página local.
// Aquí la consulta sale desde Node (sin CORS) y la página la pide a /gameinfo/<west|east|europe>/api/gameinfo/...
// Uso: npm start   (o: node server.js 5174 para cambiar el puerto)
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.argv[2] || process.env.PORT) || 5173;
// Tras «npm run build» se sirve dist/ (con el CSS de Tailwind); sin build, la carpeta del proyecto.
const ROOT = fs.existsSync(path.join(__dirname, 'dist', 'index.html')) ? path.join(__dirname, 'dist') : __dirname;
const HOSTS = { west: 'gameinfo.albiononline.com', east: 'gameinfo-sgp.albiononline.com', europe: 'gameinfo-ams.albiononline.com' };
// Solo para pruebas: GAMEINFO_UPSTREAM=http://127.0.0.1:9999 reemplaza los tres servidores.
const UPSTREAM = process.env.GAMEINFO_UPSTREAM ? new URL(process.env.GAMEINFO_UPSTREAM) : null;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json; charset=utf-8'
};

function send(res, status, body, type) {
  res.writeHead(status, { 'content-type': type || 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
}
function sendJson(res, status, obj) { send(res, status, JSON.stringify(obj), 'application/json; charset=utf-8'); }

function proxy(req, res, server, rest) {
  const target = UPSTREAM || new URL('https://' + HOSTS[server]);
  const lib = target.protocol === 'http:' ? http : https;
  let upReq;
  try {
    upReq = lib.request({
      hostname: target.hostname, port: target.port || undefined, path: rest, method: 'GET', timeout: 20000,
      headers: { 'user-agent': 'regear-albion/1.0', accept: 'application/json' }
    }, (up) => {
      res.writeHead(up.statusCode || 502, { 'content-type': up.headers['content-type'] || 'application/json', 'cache-control': 'no-store' });
      up.pipe(res);
    });
  } catch (err) {
    return sendJson(res, 400, { error: 'Ruta no válida' });
  }
  upReq.on('timeout', () => upReq.destroy(new Error('La API de Albion tardó demasiado en responder')));
  upReq.on('error', (err) => {
    if (!res.headersSent) sendJson(res, 502, { error: String(err.message) });
    else res.end();
  });
  upReq.end();
}

function serveStatic(req, res) {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
  catch (err) { return send(res, 400, 'Solicitud no válida'); }
  const file = path.normalize(path.join(ROOT, pathname === '/' ? '/index.html' : pathname));
  const inside = file.startsWith(ROOT + path.sep);
  if (!inside || file.split(path.sep).some((p) => p.startsWith('.') && p !== '.')) return send(res, 403, 'Acceso denegado');
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'No encontrado');
    send(res, 200, data, MIME[path.extname(file).toLowerCase()] || 'application/octet-stream');
  });
}

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Método no permitido');
  if (req.url === '/gameinfo/ping') return sendJson(res, 200, { ok: true });
  const m = /^\/gameinfo\/(west|east|europe)(\/api\/gameinfo\/.*)$/.exec(req.url);
  if (m) return proxy(req, res, m[1], m[2]);
  if (req.url.startsWith('/gameinfo/')) return send(res, 403, 'Solo se permite /api/gameinfo/');
  serveStatic(req, res);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') console.error('El puerto ' + PORT + ' ya está en uso. Cierra el otro servidor o ejecuta: node server.js 5174');
  else console.error(err.message);
  process.exit(1);
});
server.listen(PORT, '127.0.0.1', () => console.log('Regear Albion: http://localhost:' + PORT + '  (Ctrl+C para detener)'));
