// Captura de leads desde los artículos del blog (modal de suscripción).
// Acciones (POST JSON, campo "action"):
//   google       → { credential } ID token de Google Identity Services; se verifica en el servidor.
//   email_start  → { email } crea el suscriptor pendiente y envía un OTP de 6 dígitos por correo.
//   email_verify → { email, code } valida el OTP y activa al suscriptor.
// En todas: post_id, slug, utm_*, referrer (de qué blog vino el lead).
// Cada lead también queda como usuario de Supabase Auth con rol 'lead' (sin permisos ni sesión).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
import { createRemoteJWKSet, jwtVerify } from "npm:jose@5";
import { escapar, notificar } from "../_shared/notify.ts";
import { crearEnvioBlog } from "../_shared/blog-mailer.ts";
import { otpHtml, otpTexto } from "../_shared/templates/blog-newsletter.ts";
import { emailValido, generarOtp, generarSalt, hashOtp, igualesSeguro, texto } from "../_shared/blog-utils.ts";

const env = (k: string) => Deno.env.get(k) ?? "";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const responder = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
const OTP_VIDA_MIN = 10;
const OTP_MAX_INTENTOS = 5;

// deno-lint-ignore no-explicit-any
type Sb = any;

interface Contexto {
  post_id: string | null;
  slug: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_term: string | null;
  utm_content: string | null;
  referrer: string | null;
}

function contexto(d: Record<string, unknown>): Contexto {
  const id = texto(d.post_id, 40);
  return {
    post_id: id && /^[0-9a-f-]{36}$/i.test(id) ? id : null,
    slug: texto(d.slug, 200),
    utm_source: texto(d.utm_source, 120),
    utm_medium: texto(d.utm_medium, 120),
    utm_campaign: texto(d.utm_campaign, 160),
    utm_term: texto(d.utm_term, 160),
    utm_content: texto(d.utm_content, 160),
    referrer: texto(d.referrer, 500),
  };
}

// Crea o actualiza al suscriptor. El blog de origen es el primero (first-touch).
async function registrar(
  sb: Sb,
  p: { email: string; nombre?: string | null; avatar?: string | null; sub?: string | null; metodo: "google" | "email"; activo: boolean; ctx: Contexto },
) {
  const email = p.email.trim().toLowerCase();
  const { data: ex } = await sb.from("blog_subscribers").select("id,status,full_name,avatar_url,google_sub,verified_at").ilike("email", email).maybeSingle();
  const ahora = new Date().toISOString();
  if (!ex) {
    const { data, error } = await sb.from("blog_subscribers").insert({
      email, full_name: p.nombre ?? null, avatar_url: p.avatar ?? null, google_sub: p.sub ?? null,
      signup_method: p.metodo, status: p.activo ? "active" : "pending_verification",
      verified_at: p.activo ? ahora : null,
      source_post_id: p.ctx.post_id, source_slug: p.ctx.slug,
      utm_source: p.ctx.utm_source, utm_medium: p.ctx.utm_medium, utm_campaign: p.ctx.utm_campaign,
      utm_term: p.ctx.utm_term, utm_content: p.ctx.utm_content, referrer: p.ctx.referrer,
    }).select("id").single();
    if (error) throw new Error(`insert suscriptor: ${error.message}`);
    return { id: data.id as string, nuevo: true, activadoAhora: p.activo };
  }
  const cambios: Record<string, unknown> = { updated_at: ahora };
  if (p.nombre && !ex.full_name) cambios.full_name = p.nombre;
  if (p.avatar && !ex.avatar_url) cambios.avatar_url = p.avatar;
  if (p.sub && !ex.google_sub) cambios.google_sub = p.sub;
  let activadoAhora = false;
  if (p.activo && ex.status !== "active") {
    cambios.status = "active";
    cambios.verified_at = ex.verified_at ?? ahora;
    activadoAhora = true;
  }
  await sb.from("blog_subscribers").update(cambios).eq("id", ex.id);
  return { id: ex.id as string, nuevo: false, activadoAhora };
}

// Cada lead es también un usuario de Supabase Auth con rol 'lead' (profiles.role; sin permisos).
// Se crea desde aquí con la API de admin, ya verificada su identidad (token de Google u OTP), y guarda de qué
// blog viene. No se le entrega ninguna sesión.
async function vincularUsuario(sb: Sb, subscriberId: string, p: { email: string; nombre?: string | null; avatar?: string | null; ctx: Contexto }) {
  const email = p.email.trim().toLowerCase();
  let userId: string | null = null;
  const { data, error } = await sb.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: {
      full_name: p.nombre ?? "", avatar_url: p.avatar ?? null, signup_source: "blog",
      source_slug: p.ctx.slug, source_post_id: p.ctx.post_id,
    },
  });
  if (!error) userId = data.user?.id ?? null;
  if (!userId) {
    // Ya existía (otro blog o el admin): se enlaza sin tocar su rol.
    const { data: perfil } = await sb.from("profiles").select("id").ilike("email", email).maybeSingle();
    userId = perfil?.id ?? null;
  }
  if (userId) await sb.from("blog_subscribers").update({ user_id: userId }).eq("id", subscriberId);
  return userId;
}

async function evento(sb: Sb, subscriberId: string, type: string, ctx: Contexto, meta: Record<string, unknown> = {}) {
  await sb.from("blog_subscriber_events").insert({ subscriber_id: subscriberId, type, post_id: ctx.post_id, meta: { slug: ctx.slug, ...meta } });
}

async function avisarLead(email: string, nombre: string | null, metodo: string, ctx: Contexto) {
  const blog = ctx.slug ? `https://www.soyproceso.com/blog/${ctx.slug}` : "(sin blog)";
  const resumen = `${nombre ? nombre + " · " : ""}${email} · ${metodo === "google" ? "Google" : "Correo"}`;
  await notificar({
    asunto: `Nuevo lead desde el blog: ${ctx.slug ?? ""}`,
    remitente: "Blog Soy Proceso",
    html: `<p><b>Nuevo lead desde el blog</b></p><p>${escapar(resumen)}</p><p>Blog: <a href="${blog}">${escapar(blog)}</a></p>`,
    telegram: `🆕 <b>Nuevo lead desde el blog</b>\n${escapar(resumen)}\n${blog}`,
    texto: `Nuevo lead desde el blog: ${resumen} · ${blog}`,
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return responder({ error: "Método no permitido" }, 405);

  let d: Record<string, unknown>;
  try {
    d = await req.json();
  } catch {
    return responder({ error: "JSON inválido" }, 400);
  }
  if (typeof d.website === "string" && d.website) return responder({ ok: true }); // honeypot
  const ctx = contexto(d);
  const sb = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));

  try {
    // ---------------------------------------------------------------- Google
    if (d.action === "google") {
      const credential = texto(d.credential, 4000);
      const clientId = env("GOOGLE_OAUTH_CLIENT_ID");
      if (!credential) return responder({ error: "Falta la credencial" }, 400);
      if (!clientId) return responder({ error: "Google sin configurar" }, 503);
      let payload;
      try {
        ({ payload } = await jwtVerify(credential, JWKS, { issuer: ["https://accounts.google.com", "accounts.google.com"], audience: clientId }));
      } catch {
        return responder({ error: "Credencial de Google inválida" }, 401);
      }
      const email = String(payload.email ?? "");
      if (!email || payload.email_verified !== true) return responder({ error: "Correo de Google no verificado" }, 422);
      const nombre = typeof payload.name === "string" ? payload.name.slice(0, 120) : null;
      const r = await registrar(sb, {
        email, nombre, avatar: typeof payload.picture === "string" ? payload.picture : null,
        sub: String(payload.sub ?? ""), metodo: "google", activo: true, ctx,
      });
      if (r.nuevo || r.activadoAhora) {
        await vincularUsuario(sb, r.id, { email, nombre, avatar: typeof payload.picture === "string" ? payload.picture : null, ctx });
        await evento(sb, r.id, "signup", ctx, { method: "google" });
        await evento(sb, r.id, "verified", ctx, { method: "google" });
        await avisarLead(email, nombre, "google", ctx);
      }
      return responder({ ok: true, nombre });
    }

    // ----------------------------------------------------------- Correo: OTP
    if (d.action === "email_start") {
      const email = texto(d.email, 254)?.toLowerCase() ?? "";
      if (!emailValido(email)) return responder({ error: "Correo inválido", campo: "email" }, 422);
      const r = await registrar(sb, { email, metodo: "email", activo: false, ctx });

      // Límite: 1 por minuto y 5 por hora por suscriptor.
      const hace1h = new Date(Date.now() - 3600_000).toISOString();
      const { data: recientes } = await sb.from("blog_subscriber_otps").select("created_at").eq("subscriber_id", r.id).gte("created_at", hace1h).order("created_at", { ascending: false });
      if (recientes && recientes.length >= 5) return responder({ error: "Demasiados intentos. Prueba en una hora." }, 429);
      if (recientes?.[0] && Date.now() - new Date(recientes[0].created_at).getTime() < 60_000) {
        return responder({ error: "Espera un minuto para pedir otro código." }, 429);
      }

      const codigo = generarOtp();
      const salt = generarSalt();
      await sb.from("blog_subscriber_otps").insert({
        subscriber_id: r.id, code_hash: await hashOtp(codigo, salt), salt,
        expires_at: new Date(Date.now() + OTP_VIDA_MIN * 60_000).toISOString(),
      });
      if (r.nuevo) await evento(sb, r.id, "signup", ctx, { method: "email" });

      const envio = crearEnvioBlog();
      if (!envio) return responder({ error: "Correo sin configurar" }, 503);
      const err = await envio.enviar({ para: email, asunto: `${codigo} es tu código de Soy Proceso`, html: otpHtml(codigo), texto: otpTexto(codigo) });
      if (err) {
        console.error("OTP no enviado:", err);
        return responder({ error: "No pudimos enviar el código. Intenta de nuevo." }, 502);
      }
      return responder({ ok: true, expira_min: OTP_VIDA_MIN });
    }

    if (d.action === "email_verify") {
      const email = texto(d.email, 254)?.toLowerCase() ?? "";
      const codigo = texto(d.code, 6) ?? "";
      if (!emailValido(email) || !/^\d{6}$/.test(codigo)) return responder({ error: "Código inválido" }, 422);
      const { data: sub } = await sb.from("blog_subscribers").select("id,full_name").ilike("email", email).maybeSingle();
      if (!sub) return responder({ error: "Código incorrecto o vencido" }, 422);
      const { data: otp } = await sb.from("blog_subscriber_otps").select("*").eq("subscriber_id", sub.id).is("consumed_at", null)
        .gt("expires_at", new Date().toISOString()).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (!otp || otp.attempts >= OTP_MAX_INTENTOS) return responder({ error: "Código incorrecto o vencido. Pide uno nuevo." }, 422);
      if (!igualesSeguro(await hashOtp(codigo, otp.salt), otp.code_hash)) {
        await sb.from("blog_subscriber_otps").update({ attempts: otp.attempts + 1 }).eq("id", otp.id);
        return responder({ error: "Código incorrecto", intentos_restantes: Math.max(0, OTP_MAX_INTENTOS - otp.attempts - 1) }, 422);
      }
      await sb.from("blog_subscriber_otps").update({ consumed_at: new Date().toISOString() }).eq("id", otp.id);
      const r = await registrar(sb, { email, metodo: "email", activo: true, ctx });
      if (r.activadoAhora) {
        await vincularUsuario(sb, r.id, { email, nombre: sub.full_name, ctx });
        await evento(sb, r.id, "verified", ctx, { method: "email" });
        await avisarLead(email, sub.full_name, "email", ctx);
      }
      return responder({ ok: true });
    }

    return responder({ error: "Acción desconocida" }, 400);
  } catch (e) {
    console.error("blog-lead-capture:", e);
    return responder({ error: "Error interno" }, 500);
  }
});
