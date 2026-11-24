// Plantillas de correo del blog (HTML con tablas y estilos en línea, compatible con Gmail/Outlook).
import { escapar } from "../notify.ts";

const VERDE = "#0f4c47";
const DORADO = "#d4af37";

function marco(contenido: string, pie: string): string {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f5f4;font-family:Arial,Helvetica,sans-serif;color:#1f2937;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f5f4;padding:24px 12px;"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;">
<tr><td style="background:${VERDE};padding:22px 32px;"><span style="font-size:20px;font-weight:bold;color:#ffffff;letter-spacing:.3px;">Soy Proceso</span></td></tr>
<tr><td style="height:4px;background:${DORADO};line-height:4px;font-size:0;">&nbsp;</td></tr>
${contenido}
<tr><td style="padding:20px 32px 28px;border-top:1px solid #e5e7eb;font-size:12px;line-height:18px;color:#6b7280;">${pie}</td></tr>
</table></td></tr></table></body></html>`;
}

export interface DatosNewsletter {
  titulo: string;
  resumen: string;
  imagen: string | null;
  urlLectura: string; // ya con el redirect de tracking
  urlBaja: string;
  pixel: string;
}

export function newsletterHtml(d: DatosNewsletter): string {
  const img = d.imagen
    ? `<tr><td><a href="${d.urlLectura}"><img src="${escapar(d.imagen)}" alt="${escapar(d.titulo)}" width="600" style="display:block;width:100%;height:auto;border:0;"></a></td></tr>`
    : "";
  const cuerpo = `${img}
<tr><td style="padding:28px 32px 8px;">
<p style="margin:0 0 8px;font-size:12px;letter-spacing:1.2px;text-transform:uppercase;color:${DORADO};font-weight:bold;">Nuevo en el blog</p>
<h1 style="margin:0 0 14px;font-size:26px;line-height:32px;color:${VERDE};">${escapar(d.titulo)}</h1>
<p style="margin:0 0 24px;font-size:16px;line-height:25px;color:#374151;">${escapar(d.resumen)}</p>
<a href="${d.urlLectura}" style="display:inline-block;background:${VERDE};color:#ffffff;text-decoration:none;font-weight:bold;font-size:15px;padding:14px 28px;border-radius:999px;">Leer artículo</a>
</td></tr>
<tr><td style="padding:24px 32px 28px;font-size:15px;line-height:23px;color:#374151;">Un abrazo,<br><b style="color:${VERDE};">Equipo Soy Proceso</b><br><span style="color:#6b7280;">Especialistas en SST y bienestar laboral</span></td></tr>`;
  const pie = `Recibes este correo porque te suscribiste a los artículos del blog de Soy Proceso (soyproceso.com). Tus datos se tratan conforme a la Ley 1581 de 2012.<br>
<a href="${d.urlBaja}" style="color:#6b7280;text-decoration:underline;">Darme de baja</a>
<img src="${d.pixel}" width="1" height="1" alt="" style="display:block;border:0;">`;
  return marco(cuerpo, pie);
}

export function newsletterTexto(d: DatosNewsletter): string {
  return `${d.titulo}\n\n${d.resumen}\n\nLeer artículo: ${d.urlLectura}\n\nEquipo Soy Proceso - Especialistas en SST y bienestar laboral\n\nDarme de baja: ${d.urlBaja}`;
}

export function otpHtml(codigo: string): string {
  const cuerpo = `<tr><td style="padding:32px;">
<h1 style="margin:0 0 12px;font-size:22px;color:${VERDE};">Tu código de verificación</h1>
<p style="margin:0 0 22px;font-size:16px;line-height:24px;color:#374151;">Escribe este código en el blog para confirmar tu correo y recibir los nuevos artículos de Soy Proceso:</p>
<p style="margin:0 0 22px;text-align:center;"><span style="display:inline-block;font-size:34px;letter-spacing:10px;font-weight:bold;color:${VERDE};background:#f3f5f4;border-radius:12px;padding:14px 22px;">${escapar(codigo)}</span></p>
<p style="margin:0;font-size:14px;color:#6b7280;">El código vence en 10 minutos. Si no lo pediste, ignora este mensaje.</p>
</td></tr>`;
  return marco(cuerpo, "Soy Proceso · soyproceso.com");
}

export function otpTexto(codigo: string): string {
  return `Tu código de verificación de Soy Proceso es ${codigo}. Vence en 10 minutos. Si no lo pediste, ignora este mensaje.`;
}
