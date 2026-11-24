// Se ejecuta cuando un post pasa a "published" (lo llama el trigger blog_post_published_notify con
// pg_net, cabecera x-publish-secret) o cuando el admin pulsa "Reenviar newsletter" (sesión de admin).
//   1. Newsletter HTML a los suscriptores activos (idempotente: unique(post_id, subscriber_id)).
//      Solo si BLOG_NEWSLETTER_ENABLED=true (interruptor sin desplegar).
//   2. Indexación: reenvía el sitemap a Search Console e IndexNow (solo en la llamada del trigger).
//   3. Resumen por Telegram.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
import { enviarTelegram, escapar } from "../_shared/notify.ts";
import { crearEnvioBlog } from "../_shared/blog-mailer.ts";
import { newsletterHtml, newsletterTexto } from "../_shared/templates/blog-newsletter.ts";
import { resumenPost, SITIO, urlDePost } from "../_shared/blog-utils.ts";
import { avisarIndexNow, gscConfigurado, reenviarSitemap } from "../_shared/gsc.ts";
import { igualesSeguro } from "../_shared/blog-utils.ts";

const env = (k: string) => Deno.env.get(k) ?? "";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-publish-secret",
};
const responder = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

// deno-lint-ignore no-explicit-any
type Sb = any;

async function enviarNewsletter(sb: Sb, post: Record<string, string | null>): Promise<{ enviados: number; fallidos: number; total: number } | string> {
  if (env("BLOG_NEWSLETTER_ENABLED") !== "true") return "Newsletter apagada (BLOG_NEWSLETTER_ENABLED != true)";
  const envio = crearEnvioBlog(true);
  if (!envio) return "Correo sin configurar (AWS_SES_*)";

  // Suscriptores activos que aún no tienen fila de envío para este post.
  const { data: activos } = await sb.from("blog_subscribers").select("id,email,unsubscribe_token").eq("status", "active");
  const { data: previos } = await sb.from("blog_email_sends").select("subscriber_id").eq("post_id", post.id);
  const yaTienen = new Set((previos ?? []).map((p: { subscriber_id: string }) => p.subscriber_id));
  const nuevos = (activos ?? []).filter((a: { id: string }) => !yaTienen.has(a.id));
  if (nuevos.length) {
    await sb.from("blog_email_sends").upsert(
      nuevos.map((a: { id: string }) => ({ post_id: post.id, subscriber_id: a.id, status: "pending" })),
      { onConflict: "post_id,subscriber_id", ignoreDuplicates: true },
    );
  }
  // Pendientes (incluye reintentos de corridas anteriores que se cortaron).
  const { data: pendientes } = await sb.from("blog_email_sends")
    .select("id,token,subscriber_id,blog_subscribers!inner(email,unsubscribe_token,status)")
    .eq("post_id", post.id).eq("status", "pending");

  const base = `${env("SUPABASE_URL")}/functions/v1/blog-email-track`;
  const urlPost = urlDePost(post.slug as string);
  const resumen = resumenPost(post.excerpt, post.content);
  let enviados = 0, fallidos = 0;
  const lista = (pendientes ?? []).filter((p: { blog_subscribers: { status: string } }) => p.blog_subscribers.status === "active");
  for (let i = 0; i < lista.length; i += 10) {
    await Promise.all(lista.slice(i, i + 10).map(async (p: { id: string; token: string; blog_subscribers: { email: string; unsubscribe_token: string } }) => {
      const baja = `${base}?e=unsub&t=${p.blog_subscribers.unsubscribe_token}`;
      const datos = {
        titulo: post.title as string, resumen, imagen: post.featured_image_url,
        urlLectura: `${base}?e=click&t=${p.token}&u=${encodeURIComponent(urlPost)}`,
        urlBaja: baja, pixel: `${base}?e=open&t=${p.token}`,
      };
      const err = await envio.enviar({
        para: p.blog_subscribers.email, asunto: post.title as string,
        html: newsletterHtml(datos), texto: newsletterTexto(datos), listUnsubscribe: baja,
      });
      if (err) {
        fallidos++;
        await sb.from("blog_email_sends").update({ status: "failed", error: err.slice(0, 500) }).eq("id", p.id);
      } else {
        enviados++;
        await sb.from("blog_email_sends").update({ status: "sent", sent_at: new Date().toISOString() }).eq("id", p.id);
      }
    }));
    await dormir(1000); // ~10 correos por segundo, dentro del límite de SES
  }
  envio.cerrar();
  return { enviados, fallidos, total: lista.length };
}

async function procesar(sb: Sb, postId: string, soloNewsletter: boolean) {
  const { data: post } = await sb.from("blog_posts").select("id,title,slug,excerpt,content,featured_image_url,status").eq("id", postId).maybeSingle();
  if (!post || post.status !== "published") return;
  const lineas: string[] = [`📰 <b>Blog publicado</b>: ${escapar(post.title)}`, urlDePost(post.slug)];

  const nl = await enviarNewsletter(sb, post);
  lineas.push(typeof nl === "string" ? `✉️ Newsletter: ${escapar(nl)}` : `✉️ Newsletter: enviado a ${nl.enviados} de ${nl.total}${nl.fallidos ? `, <b>${nl.fallidos} fallidos</b>` : ""}`);

  if (!soloNewsletter) {
    const url = urlDePost(post.slug);
    if (gscConfigurado()) {
      const err = await reenviarSitemap(`${SITIO}/sitemap.xml`);
      lineas.push(err ? `🔎 Sitemap: ${escapar(err)}` : "🔎 Sitemap reenviado a Search Console");
      await sb.from("blog_index_status").upsert({ post_id: post.id, url, sitemap_submitted_at: new Date().toISOString() }, { onConflict: "post_id" });
    }
    const errIn = await avisarIndexNow([url]);
    if (errIn) lineas.push(`IndexNow: ${escapar(errIn)}`);
  }
  await enviarTelegram(lineas.join("\n"));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return responder({ error: "Método no permitido" }, 405);
  const sb = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));

  // Autorización: secreto del trigger o sesión de admin ("cualquier usuario autenticado = admin").
  const secreto = env("BLOG_ON_PUBLISH_SECRET");
  const cab = req.headers.get("x-publish-secret") ?? "";
  const desdeTrigger = !!secreto && !!cab && igualesSeguro(cab, secreto);
  if (!desdeTrigger) {
    const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data } = jwt ? await sb.auth.getUser(jwt) : { data: { user: null } };
    if (!data?.user) return responder({ error: "No autorizado" }, 401);
  }

  const d = await req.json().catch(() => ({}));
  const postId = typeof d.post_id === "string" ? d.post_id : "";
  if (!/^[0-9a-f-]{36}$/i.test(postId)) return responder({ error: "post_id inválido" }, 400);

  // Responde ya y sigue trabajando en segundo plano (el trigger solo espera unos segundos).
  // @ts-ignore EdgeRuntime existe en Supabase Edge Functions
  EdgeRuntime.waitUntil(procesar(sb, postId, !desdeTrigger).catch((e) => {
    console.error("blog-on-publish:", e);
    return enviarTelegram(`⚠️ <b>blog-on-publish falló</b>: ${escapar(e instanceof Error ? e.message : String(e))}`);
  }));
  return responder({ ok: true, accepted: true }, 202);
});
