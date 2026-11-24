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

// ---------------------------------------------------------------------------------------------
// Correo de bienvenida (se envía una sola vez, al verificar la suscripción).
// ---------------------------------------------------------------------------------------------
export interface TarjetaBlog {
  titulo: string;
  url: string; // ya con utm
  imagen: string | null;
  resumen: string;
}

export interface DatosBienvenida {
  nombre: string | null;
  origen: TarjetaBlog | null; // el artículo desde el que se suscribió
  otros: TarjetaBlog[]; // otros artículos que le pueden interesar
  urlWhatsapp: string;
  urlBaja: string;
}

const MUTED = "#6b7280";

function filaBlog(b: TarjetaBlog): string {
  const img = b.imagen
    ? `<td width="120" valign="top" style="padding:0 16px 0 0;"><a href="${b.url}"><img src="${escapar(b.imagen)}" alt="" width="120" height="84" style="display:block;width:120px;height:84px;object-fit:cover;border-radius:10px;border:0;"></a></td>`
    : "";
  return `<tr><td style="padding:0 32px 18px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${img}
<td valign="top"><a href="${b.url}" style="font-size:16px;line-height:22px;font-weight:bold;color:${VERDE};text-decoration:none;">${escapar(b.titulo)}</a>
<p style="margin:6px 0 0;font-size:14px;line-height:21px;color:${MUTED};">${escapar(b.resumen)}</p>
<a href="${b.url}" style="display:inline-block;margin-top:8px;font-size:14px;font-weight:bold;color:${DORADO};text-decoration:none;">Leer artículo &rarr;</a></td></tr></table></td></tr>`;
}

export function bienvenidaHtml(d: DatosBienvenida): string {
  const saludo = d.nombre ? `Hola ${escapar(d.nombre.split(" ")[0])},` : "Hola,";
  const origen = d.origen
    ? `<tr><td style="padding:8px 32px 6px;"><p style="margin:0 0 12px;font-size:12px;letter-spacing:1.2px;text-transform:uppercase;color:${DORADO};font-weight:bold;">El artículo que estabas leyendo</p></td></tr>
${d.origen.imagen ? `<tr><td style="padding:0 32px;"><a href="${d.origen.url}"><img src="${escapar(d.origen.imagen)}" alt="${escapar(d.origen.titulo)}" width="536" style="display:block;width:100%;height:auto;border-radius:14px;border:0;"></a></td></tr>` : ""}
<tr><td style="padding:16px 32px 26px;"><a href="${d.origen.url}" style="font-size:20px;line-height:26px;font-weight:bold;color:${VERDE};text-decoration:none;">${escapar(d.origen.titulo)}</a>
<p style="margin:8px 0 14px;font-size:15px;line-height:23px;color:#374151;">${escapar(d.origen.resumen)}</p>
<a href="${d.origen.url}" style="display:inline-block;background:${VERDE};color:#ffffff;text-decoration:none;font-weight:bold;font-size:15px;padding:13px 26px;border-radius:999px;">Seguir leyendo</a></td></tr>`
    : "";
  const otros = d.otros.length
    ? `<tr><td style="padding:6px 32px 14px;border-top:1px solid #e5e7eb;"><p style="margin:22px 0 0;font-size:12px;letter-spacing:1.2px;text-transform:uppercase;color:${DORADO};font-weight:bold;">Otros artículos que te pueden interesar</p></td></tr>
${d.otros.map(filaBlog).join("\n")}`
    : "";
  const cuerpo = `<tr><td style="padding:34px 32px 8px;">
<span style="display:none;max-height:0;overflow:hidden;opacity:0;">Gracias por suscribirte. Aquí tienes tu primer artículo y más lecturas sobre SST y bienestar laboral.</span>
<h1 style="margin:0 0 12px;font-size:28px;line-height:34px;color:${VERDE};">¡Te damos la bienvenida a Soy Proceso!</h1>
<p style="margin:0 0 10px;font-size:16px;line-height:25px;color:#374151;">${saludo}</p>
<p style="margin:0 0 18px;font-size:16px;line-height:25px;color:#374151;">Gracias por suscribirte. Somos un equipo de especialistas en Seguridad y Salud en el Trabajo (SST) y bienestar laboral, y en este correo te contamos cada vez que publicamos algo nuevo: ideas claras y aplicables para cuidar a las personas y a las empresas.</p>
</td></tr>
${origen}
${otros}
<tr><td style="padding:10px 32px 30px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ecfdf5;border-radius:16px;"><tr><td style="padding:24px 24px 26px;text-align:center;">
<p style="margin:0 0 6px;font-size:18px;line-height:24px;font-weight:bold;color:${VERDE};">¿Quieres más información o una asesoría para tu empresa?</p>
<p style="margin:0 0 16px;font-size:15px;line-height:22px;color:#374151;">Escríbenos por WhatsApp y con gusto te orientamos.</p>
<a href="${d.urlWhatsapp}" style="display:inline-block;background:#25d366;color:#ffffff;text-decoration:none;font-weight:bold;font-size:16px;padding:14px 28px;border-radius:999px;">Escribir por WhatsApp</a>
</td></tr></table></td></tr>
<tr><td style="padding:0 32px 28px;font-size:15px;line-height:23px;color:#374151;">Un abrazo,<br><b style="color:${VERDE};">Equipo Soy Proceso</b><br><span style="color:${MUTED};">Especialistas en SST y bienestar laboral</span></td></tr>`;
  const pie = `Recibes este correo porque te suscribiste a los artículos del blog de Soy Proceso (soyproceso.com). Tus datos se tratan conforme a la Ley 1581 de 2012.<br>
<a href="${d.urlBaja}" style="color:${MUTED};text-decoration:underline;">Darme de baja</a>`;
  return marco(cuerpo, pie);
}

export function bienvenidaTexto(d: DatosBienvenida): string {
  const partes = [
    "¡Te damos la bienvenida a Soy Proceso!",
    d.nombre ? `Hola ${d.nombre.split(" ")[0]},` : "Hola,",
    "Gracias por suscribirte. Te contaremos cada vez que publiquemos un artículo nuevo sobre SST y bienestar laboral.",
  ];
  if (d.origen) partes.push(`El artículo que estabas leyendo:\n${d.origen.titulo}\n${d.origen.url}`);
  if (d.otros.length) partes.push("Otros artículos que te pueden interesar:\n" + d.otros.map((b) => `- ${b.titulo}\n  ${b.url}`).join("\n"));
  partes.push(`¿Quieres más información? Escríbenos por WhatsApp: ${d.urlWhatsapp}`);
  partes.push("Equipo Soy Proceso - Especialistas en SST y bienestar laboral");
  partes.push(`Darme de baja: ${d.urlBaja}`);
  return partes.join("\n\n");
}
