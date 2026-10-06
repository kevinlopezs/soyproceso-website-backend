// Cotizador automático de la batería (landing de Google Ads con test A/B).
// Una sola función con tres acciones:
//   init      → crea la fila al cargar la landing (variante, UTMs, gclid) y devuelve lead_id.
//   progreso  → guarda cada paso del embudo (video, trabajadores, modalidad, ciudad, canal).
//   generar   → valida los datos de contacto, guarda la estimación, envía la cotización por
//               correo al lead (si eligió correo) y avisa al equipo por Telegram y correo.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
import nodemailer from "npm:nodemailer@6";
import { escapar, notificar } from "../_shared/notify.ts";

const env = (k: string) => Deno.env.get(k) ?? "";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const responder = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

// ---- Validaciones (las mismas reglas que el frontend) -----------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
const DOMINIOS_DESECHABLES = new Set([
  "mailinator.com", "yopmail.com", "guerrillamail.com", "10minutemail.com", "tempmail.com",
  "temp-mail.org", "trashmail.com", "sharklasers.com", "getnada.com", "maildrop.cc",
  "dispostable.com", "fakeinbox.com", "throwawaymail.com", "emailondeck.com", "mintemail.com",
]);

export function emailValido(email: string): boolean {
  const e = email.trim().toLowerCase();
  if (!EMAIL_RE.test(e) || e.length > 254) return false;
  return !DOMINIOS_DESECHABLES.has(e.split("@")[1]);
}

// Celular colombiano: 10 dígitos que empiezan por 3. Se aceptan +57 / 57 y separadores.
export function normalizarWhatsapp(raw: string): string | null {
  let d = raw.replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("57")) d = d.slice(2);
  if (!/^3\d{9}$/.test(d)) return null;
  if (/^(\d)\1{9}$/.test(d) || /^3(\d)\1{8}$/.test(d)) return null; // 3333333333, 3000000000
  return d;
}

const texto = (v: unknown, max = 160) =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
const entero = (v: unknown) => (Number.isInteger(v) && (v as number) > 0 ? (v as number) : null);

// ---- Estimación ---------------------------------------------------------------------------

interface Linea {
  modalidad: "virtual" | "presencial";
  titulo: string;
  min: number;
  max: number;
  incluye?: string[];
}
interface Estimacion {
  folio: string;
  trabajadores: string;
  ciudad: string;
  lineas: Linea[];
  vigencia: string;
}

function estimacionValida(e: unknown): e is Estimacion {
  if (!e || typeof e !== "object") return false;
  const x = e as Estimacion;
  return Array.isArray(x.lineas) && x.lineas.length > 0 && x.lineas.length <= 2 &&
    x.lineas.every((l) => Number.isFinite(l.min) && Number.isFinite(l.max) && l.min > 0 && l.max >= l.min);
}

const COP = (n: number) =>
  new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(n);
const rango = (l: Linea) => (l.min === l.max ? COP(l.min) : `${COP(l.min)} – ${COP(l.max)}`);

// ---- Correos ------------------------------------------------------------------------------

function correoLead(nombre: string, empresa: string, e: Estimacion): string {
  const filas = e.lineas.map((l) => `
    <tr>
      <td style="padding:14px 16px;border-bottom:1px solid #E3EFEC;">
        <div style="font-weight:700;color:#1C4A42;">${escapar(l.titulo)}</div>
        ${(l.incluye ?? []).length ? `<div style="font-size:12px;color:#5A8A82;margin-top:4px;">${l.incluye!.map(escapar).join(" · ")}</div>` : ""}
      </td>
      <td style="padding:14px 16px;border-bottom:1px solid #E3EFEC;text-align:right;font-weight:800;color:#0f4c47;white-space:nowrap;">${rango(l)}</td>
    </tr>`).join("");

  return `<!doctype html><html lang="es"><body style="margin:0;background:#F3F8F6;font-family:Arial,Helvetica,sans-serif;color:#1C4A42;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3F8F6;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;">
        <tr><td style="background:#0f4c47;padding:28px 28px 24px;">
          <div style="color:#E8C97A;font-weight:900;letter-spacing:2px;font-size:14px;">SOY PROCESO</div>
          <div style="color:#ffffff;font-size:22px;font-weight:800;margin-top:10px;">Tu cotización estimada de la batería de riesgo psicosocial</div>
          <div style="color:#ffffffb3;font-size:13px;margin-top:6px;">Folio ${escapar(e.folio)} · válida hasta el ${escapar(e.vigencia)}</div>
        </td></tr>
        <tr><td style="padding:24px 28px 8px;font-size:15px;line-height:1.6;">
          Hola ${escapar(nombre.split(" ")[0])}, esta es la estimación para <b>${escapar(empresa)}</b>
          (${escapar(e.trabajadores)} · ${escapar(e.ciudad)}).
        </td></tr>
        <tr><td style="padding:8px 28px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E3EFEC;border-radius:12px;border-collapse:separate;">
            ${filas}
          </table>
        </td></tr>
        <tr><td style="padding:16px 28px 8px;font-size:13px;line-height:1.6;color:#5A8A82;">
          Incluye la aplicación de los instrumentos oficiales del Ministerio del Trabajo (intralaboral A y B,
          extralaboral, estrés y ficha sociodemográfica), informe técnico con matriz de intervención priorizada
          y reunión de retroalimentación con líderes, conforme a la Resolución 2764 de 2022.
        </td></tr>
        <tr><td style="padding:8px 28px 24px;">
          <div style="background:#FDF5DC;border-left:4px solid #E8C97A;padding:12px 14px;border-radius:0 10px 10px 0;font-size:13px;color:#8A6800;line-height:1.5;">
            Es una <b>estimación</b>. Te contactaremos para confirmar el número de trabajadores, la logística
            y el precio exacto antes de enviarte la propuesta formal.
          </div>
        </td></tr>
        <tr><td align="center" style="padding:0 28px 28px;">
          <a href="https://wa.me/573186392462?text=${encodeURIComponent(`Hola, quiero confirmar la cotización ${e.folio} de la batería de riesgo psicosocial`)}"
             style="display:inline-block;background:#25D366;color:#ffffff;text-decoration:none;font-weight:700;padding:14px 26px;border-radius:999px;">
            Confirmar por WhatsApp
          </a>
        </td></tr>
        <tr><td style="background:#F3F8F6;padding:16px 28px;font-size:11px;color:#5A8A82;text-align:center;">
          Soy Proceso · Psicología organizacional y ocupacional · Bogotá, Colombia
        </td></tr>
      </table>
    </td></tr>
  </table></body></html>`;
}

async function enviarCorreoLead(para: string, html: string, folio: string): Promise<string | null> {
  const host = env("AWS_SES_SMTP_ENDPOINT");
  const port = Number(env("AWS_SES_SMTP_PORT") || "587");
  const user = env("AWS_SMTP_USER_NAME");
  const pass = env("AWS_SMTP_PASSWORD");
  const desde = env("AWS_SES_SENDER_EMAIL") || "contactanos@soyproceso.com";
  if (!host || !user || !pass) return "SMTP sin configurar";
  try {
    const t = nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } });
    await t.sendMail({
      from: `Soy Proceso <${desde}>`,
      to: para,
      subject: `Tu cotización estimada de la batería psicosocial · ${folio}`,
      html,
    });
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

// ---- Handler ------------------------------------------------------------------------------

const PASOS = ["video", "trabajadores", "modalidad", "ciudad", "canal", "contacto", "cotizacion"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return responder({ error: "Método no permitido" }, 405);

  let body: Record<string, any>;
  try {
    body = await req.json();
  } catch {
    return responder({ error: "JSON inválido" }, 400);
  }

  const supabase = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));

  try {
    // -- init ------------------------------------------------------------------------------
    if (body.accion === "init") {
      const u = body.utms ?? {};
      const { data, error } = await supabase.from("cotizador_leads").insert({
        variante: body.variante === "b" ? "b" : "a",
        landing: texto(body.landing, 200),
        utm_source: texto(u.utm_source),
        utm_medium: texto(u.utm_medium),
        utm_campaign: texto(u.utm_campaign),
        utm_term: texto(u.utm_term),
        utm_content: texto(u.utm_content),
        gclid: texto(u.gclid, 300),
        gbraid: texto(u.gbraid, 300),
        wbraid: texto(u.wbraid, 300),
        referrer: texto(body.referrer, 500),
        ip_address: req.headers.get("x-real-ip") || req.headers.get("x-forwarded-for")?.split(",")[0] || null,
        user_agent: texto(req.headers.get("user-agent"), 500),
      }).select("id").single();
      if (error) throw error;
      return responder({ lead_id: data.id });
    }

    const leadId = texto(body.lead_id, 64);
    if (!leadId || !/^[0-9a-f-]{36}$/i.test(leadId)) return responder({ error: "lead_id inválido" }, 400);

    const { data: lead, error: leerError } = await supabase
      .from("cotizador_leads")
      .select("id, completed_at, video_max_pct, email_enviado, equipo_notificado")
      .eq("id", leadId)
      .single();
    if (leerError || !lead) return responder({ error: "Lead no encontrado" }, 404);

    // -- progreso --------------------------------------------------------------------------
    if (body.accion === "progreso") {
      const d = body.datos ?? {};
      const cambios: Record<string, unknown> = {};
      if (PASOS.includes(body.paso)) cambios.ultimo_paso = body.paso;
      if (Number.isFinite(d.video_pct)) {
        cambios.video_max_pct = Math.max(lead.video_max_pct, Math.min(100, Math.round(d.video_pct)));
      }
      if (d.video_completo === true) cambios.video_completo = true;

      // Las respuestas ya no cambian después de generar la cotización.
      if (!lead.completed_at) {
        if ("trabajadores_exacto" in d) cambios.trabajadores_exacto = entero(d.trabajadores_exacto);
        if ("trabajadores_rango" in d) cambios.trabajadores_rango = texto(d.trabajadores_rango, 40);
        if ("trabajadores_min" in d) cambios.trabajadores_min = entero(d.trabajadores_min);
        if ("trabajadores_max" in d) cambios.trabajadores_max = entero(d.trabajadores_max);
        if (["virtual", "presencial", "ambas"].includes(d.modalidad)) cambios.modalidad = d.modalidad;
        if ("ciudad" in d) cambios.ciudad = texto(d.ciudad, 80);
        if (["correo", "whatsapp", "ambos"].includes(d.canal_envio)) cambios.canal_envio = d.canal_envio;
      } else {
        delete cambios.ultimo_paso;
      }

      if (Object.keys(cambios).length) {
        const { error } = await supabase.from("cotizador_leads").update(cambios).eq("id", leadId);
        if (error) throw error;
      }
      return responder({ ok: true });
    }

    // -- generar ---------------------------------------------------------------------------
    if (body.accion === "generar") {
      if (lead.completed_at) return responder({ ok: true, ya_generada: true, email_enviado: lead.email_enviado });

      const d = body.datos ?? {};
      const canal = d.canal_envio;
      if (!["correo", "whatsapp", "ambos"].includes(canal)) return responder({ error: "Canal inválido" }, 400);

      const quiereCorreo = canal !== "whatsapp";
      const quiereWhatsapp = canal !== "correo";
      const email = quiereCorreo ? String(d.email ?? "").trim().toLowerCase() : null;
      const whatsapp = quiereWhatsapp ? normalizarWhatsapp(String(d.whatsapp ?? "")) : null;
      if (quiereCorreo && !emailValido(email!)) return responder({ error: "Correo inválido", campo: "email" }, 422);
      if (quiereWhatsapp && !whatsapp) return responder({ error: "WhatsApp inválido", campo: "whatsapp" }, 422);

      const nombre = texto(d.nombre, 120);
      const empresa = texto(d.empresa, 160);
      if (!nombre || nombre.length < 3) return responder({ error: "Nombre requerido", campo: "nombre" }, 422);
      if (!empresa || empresa.length < 2) return responder({ error: "Empresa requerida", campo: "empresa" }, 422);
      if (d.autoriza_datos !== true) return responder({ error: "Falta la autorización de datos", campo: "autoriza_datos" }, 422);
      if (!estimacionValida(body.estimacion)) return responder({ error: "Estimación inválida" }, 422);

      const est = body.estimacion as Estimacion;
      const { error } = await supabase.from("cotizador_leads").update({
        canal_envio: canal,
        email,
        whatsapp,
        nombre,
        empresa,
        autoriza_datos: true,
        autoriza_datos_at: new Date().toISOString(),
        estimacion: est,
        ultimo_paso: "cotizacion",
        completed_at: new Date().toISOString(),
        estado: "cotizacion_generada",
      }).eq("id", leadId);
      if (error) throw error;

      const [errorCorreo, erroresEquipo] = await Promise.all([
        quiereCorreo ? enviarCorreoLead(email!, correoLead(nombre, empresa, est), est.folio) : Promise.resolve(null),
        avisarEquipo(leadId, est, { nombre, empresa, email, whatsapp, canal }),
      ]);

      const emailEnviado = quiereCorreo && errorCorreo === null;
      await supabase.from("cotizador_leads").update({
        email_enviado: emailEnviado,
        equipo_notificado: erroresEquipo.length === 0,
      }).eq("id", leadId);

      if (errorCorreo) console.error("Correo al lead falló:", errorCorreo);
      if (erroresEquipo.length) console.error("Aviso al equipo falló:", erroresEquipo);

      return responder({ ok: true, email_enviado: emailEnviado });
    }

    return responder({ error: "Acción desconocida" }, 400);
  } catch (e) {
    console.error(e);
    return responder({ error: e instanceof Error ? e.message : "Error" }, 500);
  }
});

async function avisarEquipo(
  leadId: string,
  e: Estimacion,
  c: { nombre: string; empresa: string; email: string | null; whatsapp: string | null; canal: string },
): Promise<string[]> {
  const { data } = await clienteServicio()
    .from("cotizador_leads")
    .select("variante, modalidad, utm_campaign, utm_term, gclid")
    .eq("id", leadId)
    .single();

  const lineas = e.lineas.map((l) => `${l.titulo}: ${rango(l)}`);
  const wa = c.whatsapp ? `https://wa.me/57${c.whatsapp}` : null;
  const origen = [data?.utm_campaign, data?.utm_term && `«${data.utm_term}»`, data?.gclid && "gclid"]
    .filter(Boolean).join(" · ") || "directo";

  const plano = [
    `Nuevo lead del cotizador · ${e.folio}`,
    `${c.nombre} — ${c.empresa}`,
    `${e.trabajadores} · ${e.ciudad} · ${data?.modalidad ?? ""}`,
    ...lineas,
    c.email ? `Correo: ${c.email}` : null,
    c.whatsapp ? `WhatsApp: ${c.whatsapp}` : null,
    `Enviar por: ${c.canal} · Variante ${String(data?.variante ?? "").toUpperCase()} · ${origen}`,
  ].filter(Boolean).join("\n");

  const telegram = [
    `🧾 <b>Nuevo lead del cotizador</b> · ${escapar(e.folio)}`,
    `<b>${escapar(c.nombre)}</b> — ${escapar(c.empresa)}`,
    `${escapar(e.trabajadores)} · ${escapar(e.ciudad)}`,
    ...lineas.map((l) => `• ${escapar(l)}`),
    c.email ? `✉️ ${escapar(c.email)}` : null,
    wa ? `💬 <a href="${wa}">${c.whatsapp}</a>` : null,
    `<i>Enviar por ${escapar(c.canal)} · variante ${escapar(String(data?.variante ?? "").toUpperCase())} · ${escapar(origen)}</i>`,
  ].filter(Boolean).join("\n");

  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#1C4A42;">
    <h2 style="margin:0 0 8px;">Nuevo lead del cotizador · ${escapar(e.folio)}</h2>
    ${plano.split("\n").slice(1).map((l) => `<div>${escapar(l)}</div>`).join("")}
    ${wa ? `<p><a href="${wa}">Escribir por WhatsApp</a></p>` : ""}
    <p style="color:#5A8A82;font-size:12px;">Confirmar número de trabajadores y precio exacto antes de enviar la propuesta formal.</p>
  </div>`;

  const para = (env("COTIZADOR_EMAIL_TO") || env("SECOP_EMAIL_TO")).split(",").map((s) => s.trim()).filter(Boolean);
  return notificar({
    asunto: `🧾 Lead cotizador: ${c.empresa} · ${e.trabajadores}`,
    html,
    telegram,
    texto: plano,
    remitente: "Cotizador Soy Proceso",
    para: para.length ? para : undefined,
  });
}

function clienteServicio() {
  return createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
}
