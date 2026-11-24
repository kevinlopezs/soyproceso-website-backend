// Revisión diaria (pg_cron, 08:00 Colombia) del estado de indexación de los posts publicados con la
// URL Inspection API (solo lectura: la API no puede forzar la indexación).
// Guarda el resultado en blog_index_status y avisa por Telegram de los posts sin indexar, con el
// link del blog y el link directo a la Inspección de URL de Search Console para forzarlo a mano.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
import { enviarTelegram, escapar } from "../_shared/notify.ts";
import { gscConfigurado, inspeccionarUrl } from "../_shared/gsc.ts";
import { estaIndexada, igualesSeguro, traducirCobertura, urlDePost, urlInspeccionGsc } from "../_shared/blog-utils.ts";

const env = (k: string) => Deno.env.get(k) ?? "";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-publish-secret",
};
const responder = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));
const DIA = 86_400_000;

// deno-lint-ignore no-explicit-any
async function revisar(s: any) {
  const { data: posts } = await s.from("blog_posts").select("id,title,slug,published_at,created_at").eq("status", "published");
  const { data: previos } = await s.from("blog_index_status").select("post_id,indexed");
  const eraIndexado = new Map<string, boolean>((previos ?? []).map((p: { post_id: string; indexed: boolean }) => [p.post_id, p.indexed]));

  const pendientes: string[] = [];
  const nuevos: string[] = [];
  const errores: string[] = [];
  let indexadas = 0;
  for (const p of posts ?? []) {
    const url = urlDePost(p.slug);
    try {
      const r = await inspeccionarUrl(url);
      const ok = estaIndexada(r.verdict, r.coverageState);
      await s.from("blog_index_status").upsert({
        post_id: p.id, url, verdict: r.verdict, coverage_state: r.coverageState, indexed: ok,
        last_crawl_time: r.lastCrawlTime, last_inspected_at: new Date().toISOString(),
      }, { onConflict: "post_id" });
      if (ok) {
        indexadas++;
        if (eraIndexado.get(p.id) === false) nuevos.push(`✅ Ya indexado: ${escapar(p.title)}`);
      } else {
        const publicado = new Date(p.published_at ?? p.created_at).getTime();
        const dias = Math.floor((Date.now() - publicado) / DIA);
        if (dias >= 1) { // el primer día es normal que Google aún no lo tenga
          pendientes.push(
            `• <b>${escapar(p.title)}</b>\n${url}\nMotivo: ${escapar(traducirCobertura(r.coverageState, r.verdict))} · publicado hace ${dias} día${dias === 1 ? "" : "s"}\n<a href="${urlInspeccionGsc(url)}">Abrir en Search Console</a>`,
          );
        }
      }
    } catch (e) {
      errores.push(`${p.slug}: ${e instanceof Error ? e.message : String(e)}`);
    }
    await dormir(300);
  }

  const partes: string[] = [];
  if (pendientes.length) {
    partes.push(`🔎 <b>Blogs sin indexar en Google: ${pendientes.length}</b> (${indexadas} indexados de ${(posts ?? []).length})\nEn Search Console: pega el link, "Probar URL publicada" y "Solicitar indexación".\n\n${pendientes.join("\n\n")}`);
  }
  if (nuevos.length) partes.push(nuevos.join("\n"));
  if (errores.length) partes.push(`⚠️ <b>Errores al inspeccionar</b>\n${errores.slice(0, 5).map(escapar).join("\n")}`);
  if (partes.length) await enviarTelegram(partes.join("\n\n"));
  return { total: (posts ?? []).length, indexadas, sin_indexar: pendientes.length, errores: errores.length };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return responder({ error: "Método no permitido" }, 405);
  const sb = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));

  const secreto = env("BLOG_ON_PUBLISH_SECRET");
  const cab = req.headers.get("x-publish-secret") ?? "";
  if (!(secreto && cab && igualesSeguro(cab, secreto))) {
    const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data } = jwt ? await sb.auth.getUser(jwt) : { data: { user: null } };
    if (!data?.user) return responder({ error: "No autorizado" }, 401);
  }
  if (!gscConfigurado()) return responder({ error: "GSC_SERVICE_ACCOUNT_JSON sin configurar" }, 503);

  try {
    return responder({ ok: true, ...(await revisar(sb)) });
  } catch (e) {
    console.error("blog-index-check:", e);
    await enviarTelegram(`⚠️ <b>blog-index-check falló</b>: ${escapar(e instanceof Error ? e.message : String(e))}`);
    return responder({ error: "Error interno" }, 500);
  }
});
