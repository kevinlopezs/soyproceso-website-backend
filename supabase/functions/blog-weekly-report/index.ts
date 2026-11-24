// Informe semanal interno del rendimiento del blog en Google (lunes 7:00 a. m. Colombia, pg_cron).
// Datos de Search Console + leads + newsletter, análisis con DeepSeek, correo HTML con gráficas y resumen por Telegram.
// Compara siempre con la semana anterior. Destinatarios: secret REPORT_EMAIL_TO (por defecto, solo el admin).
// Autoriza por x-publish-secret (cron) o sesión de admin. Con { test: true } no guarda el informe en la base de datos.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
import { esAdmin, ADMIN_EMAIL } from "../_shared/admin.ts";
import { gscConfigurado } from "../_shared/gsc.ts";
import { obtenerRendimiento } from "../_shared/rendimiento.ts";
import { analizarConIA, informeHtml, informeTelegram } from "../_shared/informe-semanal.ts";
import { crearEnvioBlog } from "../_shared/blog-mailer.ts";
import { enviarTelegram, escapar } from "../_shared/notify.ts";
import { emailValido, igualesSeguro } from "../_shared/blog-utils.ts";

const env = (k: string) => Deno.env.get(k) ?? "";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-publish-secret",
};
const responder = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

// deno-lint-ignore no-explicit-any
async function generar(sb: any, prueba: boolean, para?: string[], sinEnviar = false) {
  const r = await obtenerRendimiento(sb, { dias: 7 });
  const { data: previo } = await sb.from("gsc_weekly_reports").select("fecha_inicio,fecha_fin,ia").order("created_at", { ascending: false }).limit(1).maybeSingle();
  const anterior = previo
    ? { semana: `${previo.fecha_inicio} → ${previo.fecha_fin}`, veredicto: previo.ia?.veredicto, titular: previo.ia?.titular, recomendaciones: previo.ia?.recomendaciones }
    : null;

  const ia = await analizarConIA(r, anterior);
  const { html, veredicto, asunto } = informeHtml(r, ia, { prueba });

  if (sinEnviar) return { veredicto, ia, html, destinatarios: [] as string[], errorCorreo: null, errorTelegram: null, rango: r.rango };

  const destinatarios = (para?.length ? para : (env("REPORT_EMAIL_TO") || ADMIN_EMAIL).split(","))
    .map((s) => s.trim().toLowerCase()).filter((s) => emailValido(s));
  const envio = crearEnvioBlog(false, "Informe Soy Proceso");
  let errorCorreo: string | null = envio ? null : "Correo sin configurar";
  if (envio && destinatarios.length) {
    errorCorreo = await envio.enviar({ para: destinatarios.join(", "), asunto, html, texto: `${asunto}\n\nAbre este correo en un cliente que muestre HTML para ver el informe con gráficas.` });
  }
  const errorTelegram = await enviarTelegram((prueba ? "🧪 <b>PRUEBA</b>\n" : "") + informeTelegram(r, ia, veredicto));

  if (!prueba) {
    await sb.from("gsc_weekly_reports").insert({
      fecha_inicio: r.rango.inicio, fecha_fin: r.rango.fin, datos: { totales: r.totales, leads: r.leads, newsletter: r.newsletter, top: r.paginas.slice(0, 10).map((p) => ({ titulo: p.titulo, actual: p.actual, anterior: p.anterior })) },
      ia, enviado_a: destinatarios,
    });
  }
  return { veredicto, ia: !!ia, destinatarios, errorCorreo, errorTelegram, rango: r.rango };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return responder({ error: "Método no permitido" }, 405);
  const sb = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));

  const secreto = env("BLOG_ON_PUBLISH_SECRET");
  const cab = req.headers.get("x-publish-secret") ?? "";
  const desdeCron = !!secreto && !!cab && igualesSeguro(cab, secreto);
  if (!desdeCron && !(await esAdmin(sb, req.headers.get("authorization")))) return responder({ error: "No autorizado" }, 401);
  if (!gscConfigurado()) return responder({ error: "Search Console sin configurar" }, 503);

  const d = await req.json().catch(() => ({}));
  const prueba = d.test === true;
  const para = Array.isArray(d.para) ? d.para.map(String) : undefined;

  try {
    // sin_enviar: devuelve el HTML y el análisis sin mandar correo ni Telegram ni guardar (para previsualizar).
    return responder({ ok: true, ...(await generar(sb, prueba || d.sin_enviar === true, para, d.sin_enviar === true)) });
  } catch (e) {
    console.error("blog-weekly-report:", e);
    await enviarTelegram(`⚠️ <b>blog-weekly-report falló</b>: ${escapar(e instanceof Error ? e.message : String(e))}`);
    return responder({ error: "Error interno" }, 500);
  }
});
