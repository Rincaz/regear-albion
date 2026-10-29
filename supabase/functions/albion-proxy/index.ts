// Edge Function: puente hacia la API gameinfo de Albion (no envía cabeceras CORS).
// Rutas: /albion-proxy/ping  y  /albion-proxy/<west|east|europe>/api/gameinfo/...
// Despliegue: supabase functions deploy albion-proxy  (con verificación JWT: la app envía la clave anon)
const HOSTS: Record<string, string> = {
  west: "gameinfo.albiononline.com",
  east: "gameinfo-sgp.albiononline.com",
  europe: "gameinfo-ams.albiononline.com",
};
// Orígenes permitidos separados por coma (ej: https://rincaz.github.io). Vacío = cualquiera.
const ALLOWED = (Deno.env.get("ALLOWED_ORIGINS") ?? "").split(",").map((s) => s.trim()).filter(Boolean);

function cors(origin: string | null): HeadersInit {
  const ok = !ALLOWED.length || (origin !== null && ALLOWED.includes(origin));
  return {
    "access-control-allow-origin": ok ? (origin ?? "*") : "null",
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "authorization, apikey, content-type",
    "vary": "origin",
  };
}
function json(status: number, body: unknown, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(origin), "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
  if (req.method !== "GET") return json(405, { error: "Método no permitido" }, origin);

  const url = new URL(req.url);
  const path = url.pathname.replace(/^.*?\/albion-proxy/, "");
  if (path === "/ping") return json(200, { ok: true }, origin);

  const m = /^\/(west|east|europe)(\/api\/gameinfo\/[A-Za-z0-9_\-\/]*)$/.exec(path);
  if (!m) return json(403, { error: "Solo se permite /api/gameinfo/" }, origin);

  const target = `https://${HOSTS[m[1]]}${m[2]}${url.search}`;
  try {
    const up = await fetch(target, {
      headers: { "user-agent": "regear-albion/1.0", accept: "application/json" },
      signal: AbortSignal.timeout(20000),
    });
    return new Response(up.body, {
      status: up.status,
      headers: { ...cors(origin), "content-type": up.headers.get("content-type") ?? "application/json", "cache-control": "no-store" },
    });
  } catch (err) {
    console.error("albion-proxy", target, err);
    const msg = err instanceof Error && err.name === "TimeoutError" ? "La API de Albion tardó demasiado en responder" : String(err);
    return json(502, { error: msg }, origin);
  }
});
