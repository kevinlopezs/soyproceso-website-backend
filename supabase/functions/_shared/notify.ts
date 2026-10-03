// Envío de avisos por Telegram y por correo (Amazon SES v2).
import { AwsClient } from "npm:aws4fetch@1.0.20";

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
  const region = env("SES_REGION");
  const accessKeyId = env("SES_ACCESS_KEY_ID");
  const secretAccessKey = env("SES_SECRET_ACCESS_KEY");
  const desde = env("SECOP_EMAIL_FROM");
  const para = env("SECOP_EMAIL_TO").split(",").map((s) => s.trim()).filter(Boolean);
  if (!region || !accessKeyId || !secretAccessKey || !desde || para.length === 0) {
    return "Correo sin configurar (SES_REGION / SES_ACCESS_KEY_ID / SES_SECRET_ACCESS_KEY / SECOP_EMAIL_FROM / SECOP_EMAIL_TO)";
  }
  const aws = new AwsClient({ accessKeyId, secretAccessKey, region, service: "ses" });
  const r = await aws.fetch(`https://email.${region}.amazonaws.com/v2/email/outbound-emails`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      FromEmailAddress: desde,
      Destination: { ToAddresses: para },
      Content: {
        Simple: {
          Subject: { Data: aviso.asunto, Charset: "UTF-8" },
          Body: {
            Html: { Data: aviso.html, Charset: "UTF-8" },
            Text: { Data: aviso.texto, Charset: "UTF-8" },
          },
        },
      },
    }),
  });
  if (!r.ok) return `SES respondió ${r.status}: ${await r.text()}`;
  return null;
}

// Envía por ambos canales; devuelve los errores (vacío si todo salió bien).
export async function notificar(aviso: Aviso): Promise<string[]> {
  const errores = await Promise.all([enviarTelegram(aviso.telegram), enviarCorreo(aviso)]);
  return errores.filter((e): e is string => e !== null);
}
