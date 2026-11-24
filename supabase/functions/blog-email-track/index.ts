// Tracking público de los correos del blog.
//   GET  ?e=open&t=TOKEN                → pixel GIF 1x1, registra la apertura.
//   GET  ?e=click&t=TOKEN&u=URL         → registra el clic y redirige (302) SOLO a soyproceso.com.
//   GET  ?e=unsub&t=UNSUBSCRIBE_TOKEN   → da de baja al suscriptor y redirige a /unsubscribed.
//   POST {e:"return", token}            → el blog lo llama cuando alguien llega con ?sp_t=TOKEN.
// Las aperturas por pixel son aproximadas (Apple Mail Privacy las infla): la métrica principal es
// clic + regreso.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
import { conParametros, SITIO, urlPermitida } from "../_shared/blog-utils.ts";

const env = (k: string) => Deno.env.get(k) ?? "";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GIF = Uint8Array.from(atob("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"), (c) => c.charCodeAt(0));

// deno-lint-ignore no-explicit-any
type Sb = any;

async function buscarEnvio(sb: Sb, token: string) {
  if (!UUID.test(token)) return null;
  const { data } = await sb.from("blog_email_sends").select("id,subscriber_id,post_id,open_count,click_count,returned_at,blog_posts(slug)").eq("token", token).maybeSingle();
  return data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const sb = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
  const ahora = new Date().toISOString();

  try {
    if (req.method === "POST") {
      const d = await req.json().catch(() => ({}));
      if (d.e !== "return" || typeof d.token !== "string") return new Response(JSON.stringify({ ok: false }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
      const s = await buscarEnvio(sb, d.token);
      if (s && !s.returned_at) {
        await sb.from("blog_email_sends").update({ returned_at: ahora }).eq("id", s.id);
        await sb.from("blog_subscriber_events").insert({ subscriber_id: s.subscriber_id, send_id: s.id, post_id: s.post_id, type: "return_visit", meta: { slug: s.blog_posts?.slug ?? null } });
      }
      return new Response(JSON.stringify({ ok: true }), { headers: { ...cors, "Content-Type": "application/json" } });
    }

    const url = new URL(req.url);
    const e = url.searchParams.get("e");
    const t = url.searchParams.get("t") ?? "";

    if (e === "open") {
      const s = await buscarEnvio(sb, t);
      if (s) {
        await sb.from("blog_email_sends").update({ opened_at: ahora, open_count: s.open_count + 1 }).eq("id", s.id);
        await sb.from("blog_subscriber_events").insert({ subscriber_id: s.subscriber_id, send_id: s.id, post_id: s.post_id, type: "open" });
      }
      return new Response(GIF, { headers: { "Content-Type": "image/gif", "Cache-Control": "no-store, max-age=0" } });
    }

    if (e === "click") {
      const destino = url.searchParams.get("u") ?? "";
      const s = await buscarEnvio(sb, t);
      if (!urlPermitida(destino)) return Response.redirect(SITIO, 302);
      if (s) {
        await sb.from("blog_email_sends").update({ clicked_at: ahora, click_count: s.click_count + 1 }).eq("id", s.id);
        await sb.from("blog_subscriber_events").insert({ subscriber_id: s.subscriber_id, send_id: s.id, post_id: s.post_id, type: "click" });
      }
      const slug = s?.blog_posts?.slug as string | undefined;
      return Response.redirect(
        conParametros(destino, { utm_source: "newsletter", utm_medium: "email", ...(slug ? { utm_campaign: slug } : {}), ...(s ? { sp_t: t } : {}) }),
        302,
      );
    }

    if (e === "unsub") {
      if (UUID.test(t)) {
        const { data: sub } = await sb.from("blog_subscribers").select("id,status").eq("unsubscribe_token", t).maybeSingle();
        if (sub && sub.status !== "unsubscribed") {
          await sb.from("blog_subscribers").update({ status: "unsubscribed", updated_at: ahora }).eq("id", sub.id);
          await sb.from("blog_subscriber_events").insert({ subscriber_id: sub.id, type: "unsubscribe" });
        }
      }
      return Response.redirect(`${SITIO}/unsubscribed?source=blog`, 302);
    }

    return new Response("Not found", { status: 404 });
  } catch (err) {
    console.error("blog-email-track:", err);
    // Un fallo de tracking nunca debe romper la experiencia del lector.
    if (req.method === "GET" && new URL(req.url).searchParams.get("e") === "open") {
      return new Response(GIF, { headers: { "Content-Type": "image/gif" } });
    }
    return Response.redirect(SITIO, 302);
  }
});
