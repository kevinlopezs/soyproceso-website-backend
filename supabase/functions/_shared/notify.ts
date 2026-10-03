// Envío de avisos por Telegram y por correo (Amazon SES por SMTP, la misma configuración
// que usa autodiagnostico-submit).
import nodemailer from "npm:nodemailer@6";

export interface Aviso {
  asunto: string;
  html: string; // HTML para correo
  telegram: string; // HTML con el subconjunto que acepta Telegram (<b>, <i>, <a>)
  texto: string; // versión en texto plano
}

const env = (k: string) => Deno.env.get(k) ?? "";

export function escapar(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Telegram limita cada mensaje a 4096 caracteres: se parte por líneas.
function partir(texto: string, max = 3800): string[] {
  const partes: string[] = [];
  let actual = "";
  for (const linea of texto.split("\n")) {
    if ((actual + "\n" + linea).length > max) {
      partes.push(actual);
      actual = linea;
    } else {
      actual = actual ? `${actual}\n${linea}` : linea;
    }
  }
  if (actual) partes.push(actual);
  return partes;
}

export async function enviarTelegram(mensaje: string): Promise<string | null> {
  const token = env("TELEGRAM_BOT_TOKEN");
  const chatId = env("TELEGRAM_CHAT_ID");
  if (!token || !chatId) return "Telegram sin configurar (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID)";
  for (const parte of partir(mensaje)) {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: parte, parse_mode: "HTML", disable_web_page_preview: true }),
    });
    if (!r.ok) return `Telegram respondió ${r.status}: ${await r.text()}`;
  }
  return null;
}

export async function enviarCorreo(aviso: Aviso): Promise<string | null> {
  const host = env("AWS_SES_SMTP_ENDPOINT");
  const port = Number(env("AWS_SES_SMTP_PORT") || "587");
  const user = env("AWS_SMTP_USER_NAME");
  const pass = env("AWS_SMTP_PASSWORD");
  const desde = env("SECOP_EMAIL_FROM") || env("AWS_SES_SENDER_EMAIL");
  // Sin SECOP_EMAIL_TO, el aviso llega al buzón remitente de Soy Proceso.
  const para = (env("SECOP_EMAIL_TO") || desde).split(",").map((s) => s.trim()).filter(Boolean);
  if (!host || !user || !pass || !desde || para.length === 0) {
    return "Correo sin configurar (AWS_SES_SMTP_ENDPOINT / AWS_SMTP_USER_NAME / AWS_SMTP_PASSWORD / AWS_SES_SENDER_EMAIL)";
  }
  try {
    const transporte = nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } });
    await transporte.sendMail({
      from: `Licitaciones Soy Proceso <${desde}>`,
      to: para.join(", "),
      subject: aviso.asunto,
      html: aviso.html,
      text: aviso.texto,
    });
    return null;
  } catch (e) {
    return `Correo falló: ${e instanceof Error ? e.message : String(e)}`;
  }
}

// Envía por ambos canales; devuelve los errores (vacío si todo salió bien).
export async function notificar(aviso: Aviso): Promise<string[]> {
  const errores = await Promise.all([enviarTelegram(aviso.telegram), enviarCorreo(aviso)]);
  return errores.filter((e): e is string => e !== null);
}
