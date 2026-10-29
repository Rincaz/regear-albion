// Arma dist/ para Vercel: copia los archivos estáticos (el CSS ya lo generó Tailwind en dist/style.css).
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist');
const FILES = ['index.html', 'stock.html', 'app.js', 'stock.js', 'data.js', 'cloud.js', 'config.js', 'pwa.js', 'sw.js', 'manifest.webmanifest', 'icons'];

mkdirSync(out, { recursive: true });
for (const f of FILES) {
  const src = join(root, f);
  if (!existsSync(src)) { console.error('Falta ' + f); process.exit(1); }
  cpSync(src, join(out, f), { recursive: true });
}
if (!existsSync(join(out, 'style.css'))) { console.error('Falta dist/style.css: ejecuta primero Tailwind (npm run build).'); process.exit(1); }
console.log('dist/ listo con ' + FILES.length + ' entradas + style.css');
