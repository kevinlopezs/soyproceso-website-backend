// Rendimiento de los blogs en Google para el panel de admin (solo rol admin).
//   POST { dias?: 7|28|90, inicio?: "YYYY-MM-DD", fin?: "YYYY-MM-DD" }      → rendimiento completo vs periodo anterior
//   POST { accion: "consultas", url, inicio, fin }                          → búsquedas que llevan a una página
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
import { esAdmin } from "../_shared/admin.ts";
import { gscConfigurado } from "../_shared/gsc.ts";
import { consultasDePagina, obtenerRendimiento } from "../_shared/rendimiento.ts";
import { SITIO } from "../_shared/blog-utils.ts";

const env = (k: string) => Deno.env.get(k) ?? "";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const responder = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return responder({ error: "Método no permitido" }, 405);
  const sb = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
  if (!(await esAdmin(sb, req.headers.get("authorization")))) return responder({ error: "No autorizado" }, 401);
  if (!gscConfigurado()) return responder({ error: "Search Console sin configurar" }, 503);

  const d = await req.json().catch(() => ({}));
  try {
    if (d.accion === "consultas") {
      const url = String(d.url ?? "");
      if (!url.startsWith(SITIO)) return responder({ error: "URL inválida" }, 400);
      return responder({ consultas: await consultasDePagina(url, String(d.inicio ?? ""), String(d.fin ?? "")) });
    }
    const dias = Number.isFinite(d.dias) ? Number(d.dias) : 28;
    return responder(await obtenerRendimiento(sb, { dias, inicio: d.inicio, fin: d.fin }));
  } catch (e) {
    console.error("gsc-performance:", e);
    return responder({ error: e instanceof Error ? e.message : "Error interno" }, 500);
  }
});
