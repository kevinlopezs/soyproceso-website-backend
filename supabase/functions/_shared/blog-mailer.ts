// Envío de correos a suscriptores del blog por Amazon SES (SMTP), mismas variables que notify.ts.
import nodemailer from "npm:nodemailer@6";

const env = (k: string) => Deno.env.get(k) ?? "";

export interface CorreoBlog {
  para: string;
  asunto: string;
  html: string;
  texto: string;
  listUnsubscribe?: string; // URL de baja (RFC 8058)
}

export function crearEnvioBlog(pool = false) {
  const host = env("AWS_SES_SMTP_ENDPOINT");
  const port = Number(env("AWS_SES_SMTP_PORT") || "587");
  const user = env("AWS_SMTP_USER_NAME");
  const pass = env("AWS_SMTP_PASSWORD");
  const desde = env("AWS_SES_SENDER_EMAIL") || env("SECOP_EMAIL_FROM");
  if (!host || !user || !pass || !desde) return null;
  const transporte = nodemailer.createTransport({
    host, port, secure: port === 465, auth: { user, pass },
    ...(pool ? { pool: true, maxConnections: 3, maxMessages: 100 } : {}),
  });
  return {
    async enviar(c: CorreoBlog): Promise<string | null> {
      try {
        await transporte.sendMail({
          from: `Soy Proceso <${desde}>`,
          to: c.para,
          subject: c.asunto,
          html: c.html,
          text: c.texto,
          headers: c.listUnsubscribe
            ? { "List-Unsubscribe": `<${c.listUnsubscribe}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" }
            : undefined,
        });
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : String(e);
      }
    },
    cerrar() { transporte.close?.(); },
  };
}
