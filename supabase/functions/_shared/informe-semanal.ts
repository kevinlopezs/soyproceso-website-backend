// Informe semanal interno del blog: análisis con DeepSeek + correo HTML con gráficas hechas con tablas
// (los clientes de correo no ejecutan JavaScript ni muestran SVG de forma fiable).
import { escapar } from "./notify.ts";
import type { FilaPagina, Metricas, Rendimiento } from "./rendimiento.ts";
import { SITIO } from "./blog-utils.ts";

const VERDE = "#0f4c47";
const DORADO = "#d4af37";
const OK = "#16a34a";
const MAL = "#dc2626";
const NEUTRO = "#6b7280";

export interface Recomendacion {
  prioridad: "alta" | "media" | "baja";
  titulo: string;
  detalle: string;
  blog?: string;
}
export interface ProximoBlog {
  titulo: string; // título sugerido del artículo
  palabra_clave: string; // búsqueda principal que debe atacar
  por_que: string; // qué datos lo respaldan
  enfoque: string; // cómo abordarlo
  puntos: string[]; // estructura / secciones sugeridas
  enlazar_a: string[]; // blogs o servicios a enlazar
}
export interface AnalisisIA {
  veredicto: "mejoró" | "igual" | "empeoró";
  titular: string;
  resumen: string;
  mejoras: string[];
  alertas: string[];
  seguimiento: { tema: string; estado: string }[];
  recomendaciones: Recomendacion[];
  ideas_contenido: string[];
  conclusion: string;
  proximo_blog: ProximoBlog | null;
  alternativas: { titulo: string; por_que: string }[];
}

const n0 = (n: number) => Math.round(n).toLocaleString("es-CO");
const n1 = (n: number) => n.toLocaleString("es-CO", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const pct = (r: number) => `${(r * 100).toLocaleString("es-CO", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;
const corta = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);

export function veredictoNumerico(r: Rendimiento): "mejoró" | "igual" | "empeoró" {
  const a = r.totales.actual, p = r.totales.anterior;
  const dc = p.clicks ? (a.clicks - p.clicks) / p.clicks : a.clicks > 0 ? 1 : 0;
  const di = p.impressions ? (a.impressions - p.impressions) / p.impressions : a.impressions > 0 ? 1 : 0;
  const score = dc * 0.6 + di * 0.4;
  return score > 0.08 ? "mejoró" : score < -0.08 ? "empeoró" : "igual";
}

// ---- Análisis con DeepSeek ------------------------------------------------------------------

const SISTEMA = `Eres el analista SEO y de contenidos de Soy Proceso, una consultora colombiana de psicología organizacional, SST (Seguridad y Salud en el Trabajo) y riesgo psicosocial. Recibes datos reales de Google Search Console de la semana y de la semana anterior, leads del blog y la newsletter. Escribe un análisis para el equipo interno, en español, claro, concreto y sin relleno.
Reglas:
- Usa SOLO los datos recibidos; no inventes cifras ni causas. Si hay pocos datos, dilo.
- Compara siempre con la semana anterior y di si algo mejoró o empeoró. Para la posición, un número MENOR es mejor.
- Nombra los blogs por su título. Las recomendaciones deben ser accionables esta semana (título y meta descripción, enlaces internos, actualizar o ampliar un artículo, nuevo contenido a partir de las búsquedas reales, CTA hacia WhatsApp o la batería de riesgo psicosocial, etc.).
- Si recibes "informe_anterior", revisa en "seguimiento" qué pasó con esas recomendaciones usando los datos de esta semana.
- El cierre es lo más importante: "conclusion" resume en 2 a 3 frases qué está funcionando y qué no, y "proximo_blog" debe decir EXACTAMENTE qué artículo deberíamos escribir a continuación, justificado con los datos: búsquedas reales con impresiones que ningún blog responde bien, temas que ya traen clics y se pueden profundizar, blogs que traen leads, y posiciones 8 a 20 que un artículo nuevo enlazado podría empujar. Da un título concreto, la palabra clave principal, por qué (con cifras), el enfoque, 4 a 6 puntos de estructura y a qué blogs o servicios enlazar. En "alternativas" da 2 opciones más (título y por qué).
- Responde SOLO un objeto JSON con estas claves: veredicto ("mejoró"|"igual"|"empeoró"), titular (máx. 90 caracteres), resumen (2 a 3 frases), mejoras (lista de frases), alertas (lista de frases), seguimiento (lista de {tema, estado}), recomendaciones (lista de {prioridad: "alta"|"media"|"baja", titulo, detalle, blog (título del blog o vacío)}, máx. 6), ideas_contenido (lista de 3 ideas breves), conclusion (texto), proximo_blog ({titulo, palabra_clave, por_que, enfoque, puntos: lista, enlazar_a: lista}), alternativas (lista de {titulo, por_que}).`;

function compactar(r: Rendimiento, anterior: unknown) {
  const m = (x: Metricas) => ({ clics: x.clicks, impresiones: x.impressions, ctr: +(x.ctr * 100).toFixed(2), posicion: +x.position.toFixed(1) });
  return {
    semana: r.rango, semana_anterior: r.anterior,
    totales: { esta_semana: m(r.totales.actual), semana_anterior: m(r.totales.anterior) },
    blogs: r.paginas.filter((p) => p.tipo !== "otra").slice(0, 16).map((p) => ({
      titulo: p.titulo, esta_semana: m(p.actual), semana_anterior: m(p.anterior), leads: p.leads,
    })),
    busquedas: r.consultas.slice(0, 15).map((c) => ({ consulta: c.consulta, ...m(c.actual), clics_semana_anterior: c.anterior?.clicks ?? 0 })),
    dispositivos: r.dispositivos, paises: r.paises,
    leads: { esta_semana: r.leads.actual, semana_anterior: r.leads.anterior, por_blog: r.leads.porBlog.slice(0, 6) },
    newsletter: r.newsletter, indexacion: r.indexacion,
    informe_anterior: anterior ?? null,
  };
}

function lista(v: unknown, max = 8): string[] {
  return Array.isArray(v) ? v.map((x) => String(x ?? "").trim()).filter(Boolean).slice(0, max) : [];
}

export async function analizarConIA(r: Rendimiento, anterior: unknown): Promise<AnalisisIA | null> {
  const key = Deno.env.get("DEEPSEEK_API_KEY");
  if (!key) return null;
  try {
    const res = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [{ role: "system", content: SISTEMA }, { role: "user", content: JSON.stringify(compactar(r, anterior)) }],
        response_format: { type: "json_object" },
        temperature: 0.3,
        max_tokens: 3500,
      }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) {
      console.error("DeepSeek", res.status, (await res.text()).slice(0, 300));
      return null;
    }
    const j = await res.json();
    const o = JSON.parse(j.choices?.[0]?.message?.content ?? "{}");
    const v = ["mejoró", "igual", "empeoró"].includes(o.veredicto) ? o.veredicto : veredictoNumerico(r);
    return {
      veredicto: v,
      titular: String(o.titular ?? "").slice(0, 140),
      resumen: String(o.resumen ?? "").slice(0, 900),
      mejoras: lista(o.mejoras),
      alertas: lista(o.alertas),
      seguimiento: Array.isArray(o.seguimiento)
        ? o.seguimiento.map((s: { tema?: unknown; estado?: unknown }) => ({ tema: String(s?.tema ?? ""), estado: String(s?.estado ?? "") })).filter((s: { tema: string }) => s.tema).slice(0, 6)
        : [],
      recomendaciones: Array.isArray(o.recomendaciones)
        ? o.recomendaciones.slice(0, 6).map((x: Record<string, unknown>) => ({
          prioridad: ["alta", "media", "baja"].includes(String(x.prioridad)) ? String(x.prioridad) as Recomendacion["prioridad"] : "media",
          titulo: String(x.titulo ?? "").slice(0, 160), detalle: String(x.detalle ?? "").slice(0, 700), blog: String(x.blog ?? "").slice(0, 160),
        })).filter((x: Recomendacion) => x.titulo)
        : [],
      ideas_contenido: lista(o.ideas_contenido, 5),
      conclusion: String(o.conclusion ?? "").slice(0, 900),
      proximo_blog: o.proximo_blog && o.proximo_blog.titulo
        ? {
          titulo: String(o.proximo_blog.titulo).slice(0, 200), palabra_clave: String(o.proximo_blog.palabra_clave ?? "").slice(0, 120),
          por_que: String(o.proximo_blog.por_que ?? "").slice(0, 800), enfoque: String(o.proximo_blog.enfoque ?? "").slice(0, 800),
          puntos: lista(o.proximo_blog.puntos, 7), enlazar_a: lista(o.proximo_blog.enlazar_a, 5),
        }
        : null,
      alternativas: Array.isArray(o.alternativas)
        ? o.alternativas.slice(0, 3).map((x: { titulo?: unknown; por_que?: unknown }) => ({ titulo: String(x?.titulo ?? "").slice(0, 200), por_que: String(x?.por_que ?? "").slice(0, 400) })).filter((x: { titulo: string }) => x.titulo)
        : [],
    };
  } catch (e) {
    console.error("DeepSeek falló:", e);
    return null;
  }
}

// ---- Correo ----------------------------------------------------------------------------------

function delta(act: number, ant: number, opciones: { menorEsMejor?: boolean; decimales?: boolean; sufijo?: string } = {}): string {
  const dif = act - ant;
  if (Math.abs(dif) < (opciones.decimales ? 0.05 : 0.5)) return `<span style="color:${NEUTRO};">= igual que la semana anterior</span>`;
  const sube = dif > 0;
  const bueno = opciones.menorEsMejor ? !sube : sube;
  const color = bueno ? OK : MAL;
  const flecha = sube ? "▲" : "▼";
  const valor = opciones.decimales ? n1(Math.abs(dif)) : n0(Math.abs(dif));
  const porc = ant ? ` (${sube ? "+" : "-"}${Math.abs(Math.round((dif / ant) * 100))} %)` : "";
  return `<span style="color:${color};font-weight:bold;">${flecha} ${valor}${opciones.sufijo ?? ""}${opciones.decimales ? "" : porc}</span> <span style="color:${NEUTRO};">vs. semana anterior</span>`;
}

function kpi(titulo: string, valor: string, cambio: string): string {
  return `<td width="50%" valign="top" style="padding:6px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8faf9;border:1px solid #e5e7eb;border-radius:14px;"><tr><td style="padding:14px 16px;">
<div style="font-size:12px;color:${NEUTRO};text-transform:uppercase;letter-spacing:.8px;">${titulo}</div>
<div style="font-size:30px;line-height:36px;font-weight:bold;color:${VERDE};">${valor}</div>
<div style="font-size:12px;line-height:17px;">${cambio}</div></td></tr></table></td>`;
}

function graficaDiaria(serie: Rendimiento["serie"], clave: "clicks" | "impressions", titulo: string): string {
  const prevClave = clave === "clicks" ? "clicksPrev" : "impressionsPrev";
  const max = Math.max(1, ...serie.map((s) => Math.max(s[clave], s[prevClave])));
  const dias = ["D", "L", "M", "X", "J", "V", "S"];
  const cols = serie.map((s) => {
    const ha = Math.max(s[clave] ? 3 : 1, Math.round((s[clave] / max) * 90));
    const hp = Math.max(s[prevClave] ? 3 : 1, Math.round((s[prevClave] / max) * 90));
    const dia = dias[new Date(s.fecha + "T12:00:00Z").getUTCDay()];
    return `<td align="center" valign="bottom" style="padding:0 2px;"><div style="font-size:11px;color:${VERDE};font-weight:bold;">${s[clave] ? n0(s[clave]) : ""}</div>
<table role="presentation" cellpadding="0" cellspacing="0"><tr><td valign="bottom"><div style="width:11px;height:${hp}px;background:#d1d5db;border-radius:3px 3px 0 0;font-size:0;line-height:0;">&nbsp;</div></td>
<td valign="bottom" style="padding-left:2px;"><div style="width:11px;height:${ha}px;background:${VERDE};border-radius:3px 3px 0 0;font-size:0;line-height:0;">&nbsp;</div></td></tr></table>
<div style="font-size:11px;color:${NEUTRO};padding-top:3px;">${dia}</div></td>`;
  }).join("");
  return `<tr><td style="padding:4px 26px 8px;"><div style="font-size:15px;font-weight:bold;color:${VERDE};margin:12px 0 2px;">${titulo}</div>
<div style="font-size:12px;color:${NEUTRO};margin-bottom:8px;"><span style="display:inline-block;width:10px;height:10px;background:${VERDE};border-radius:2px;"></span> esta semana &nbsp; <span style="display:inline-block;width:10px;height:10px;background:#d1d5db;border-radius:2px;"></span> semana anterior</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${cols}</tr></table></td></tr>`;
}

function filaBlog(p: FilaPagina, max: number): string {
  const ancho = Math.max(p.actual.clicks > 0 ? 4 : 1, Math.round((p.actual.clicks / max) * 100));
  const a = p.actual, b = p.anterior;
  const dc = a.clicks - b.clicks;
  const chip = dc > 0 ? `<span style="color:${OK};font-weight:bold;">▲ ${dc}</span>` : dc < 0 ? `<span style="color:${MAL};font-weight:bold;">▼ ${Math.abs(dc)}</span>` : `<span style="color:${NEUTRO};">=</span>`;
  const oportunidad = a.impressions >= 100 && a.ctr < 0.01
    ? `<span style="color:#b45309;"> · 💡 muchas impresiones, pocos clics</span>`
    : a.impressions >= 50 && a.position > 8 && a.position <= 20 ? `<span style="color:#b45309;"> · 💡 cerca de la primera página</span>` : "";
  return `<tr><td style="padding:0 26px 14px;"><a href="${p.url}" style="font-size:14px;line-height:19px;font-weight:bold;color:#111827;text-decoration:none;">${escapar(corta(p.titulo, 80))}</a>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 4px;"><tr><td width="${ancho}%" style="background:${VERDE};height:8px;border-radius:4px;font-size:0;line-height:0;">&nbsp;</td><td style="font-size:0;">&nbsp;</td></tr></table>
<div style="font-size:12px;line-height:18px;color:${NEUTRO};"><b style="color:#111827;">${n0(a.clicks)}</b> clics ${chip} · ${n0(a.impressions)} impresiones · CTR ${pct(a.ctr)} · posición ${a.impressions ? n1(a.position) : "—"}${p.leads ? ` · <b style="color:${VERDE};">${p.leads} lead${p.leads > 1 ? "s" : ""}</b>` : ""}${oportunidad}</div></td></tr>`;
}

const CHIP: Record<string, string> = { alta: MAL, media: "#d97706", baja: NEUTRO };

function seccion(titulo: string, cuerpo: string): string {
  return cuerpo ? `<tr><td style="padding:18px 26px 6px;border-top:1px solid #e5e7eb;"><div style="font-size:17px;font-weight:bold;color:${VERDE};">${titulo}</div></td></tr>${cuerpo}` : "";
}
const ul = (items: string[], color: string) =>
  items.length ? `<tr><td style="padding:2px 26px 8px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${items.map((t) => `<tr><td width="18" valign="top" style="color:${color};font-size:16px;line-height:22px;">•</td><td style="font-size:14px;line-height:22px;color:#374151;padding-bottom:4px;">${escapar(t)}</td></tr>`).join("")}</table></td></tr>` : "";

export function informeHtml(r: Rendimiento, ia: AnalisisIA | null, opts: { prueba?: boolean } = {}): { html: string; veredicto: "mejoró" | "igual" | "empeoró"; asunto: string } {
  const veredicto = ia?.veredicto ?? veredictoNumerico(r);
  const color = veredicto === "mejoró" ? OK : veredicto === "empeoró" ? MAL : NEUTRO;
  const emoji = veredicto === "mejoró" ? "📈" : veredicto === "empeoró" ? "📉" : "➖";
  const a = r.totales.actual, p = r.totales.anterior;
  const fmtRango = (i: string, f: string) => {
    const o = { day: "numeric", month: "short", timeZone: "UTC" } as const;
    return `${new Date(i + "T12:00:00Z").toLocaleDateString("es-CO", o)} – ${new Date(f + "T12:00:00Z").toLocaleDateString("es-CO", o)}`;
  };
  const rango = fmtRango(r.rango.inicio, r.rango.fin);
  const blogs = r.paginas.filter((x) => x.tipo === "blog");
  const conTrafico = blogs.filter((x) => x.actual.impressions > 0);
  const maxClics = Math.max(1, ...blogs.map((x) => x.actual.clicks));
  const sinTrafico = blogs.filter((x) => x.actual.impressions === 0).length;

  const veredictoBox = `<tr><td style="padding:0 26px 8px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${color}14;border-left:5px solid ${color};border-radius:10px;"><tr><td style="padding:14px 16px;">
<div style="font-size:12px;letter-spacing:1px;text-transform:uppercase;color:${color};font-weight:bold;">${emoji} Esta semana ${veredicto === "igual" ? "se mantuvo igual" : veredicto} frente a la anterior</div>
<div style="font-size:18px;line-height:24px;font-weight:bold;color:#111827;margin-top:4px;">${escapar(ia?.titular || (veredicto === "mejoró" ? "Más visibilidad que la semana pasada" : veredicto === "empeoró" ? "Menos visibilidad que la semana pasada" : "Visibilidad estable"))}</div>
${ia?.resumen ? `<div style="font-size:14px;line-height:22px;color:#374151;margin-top:6px;">${escapar(ia.resumen)}</div>` : ""}</td></tr></table></td></tr>`;

  const kpis = `<tr><td style="padding:6px 20px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr>${kpi("Clics desde Google", n0(a.clicks), delta(a.clicks, p.clicks))}${kpi("Impresiones", n0(a.impressions), delta(a.impressions, p.impressions))}</tr>
<tr>${kpi("CTR", pct(a.ctr), delta(a.ctr * 100, p.ctr * 100, { decimales: true, sufijo: " pts" }))}${kpi("Posición media", a.impressions ? n1(a.position) : "—", a.impressions && p.impressions ? delta(a.position, p.position, { menorEsMejor: true, decimales: true, sufijo: " pos." }) : `<span style="color:${NEUTRO};">sin comparación</span>`)}</tr>
<tr>${kpi("Leads nuevos (suscriptores)", n0(r.leads.actual), delta(r.leads.actual, r.leads.anterior))}${kpi("Newsletter", `${n0(r.newsletter.enviados)} <span style="font-size:14px;color:${NEUTRO};">enviados</span>`, `<span style="color:#374151;">${n0(r.newsletter.clics)} clics · ${n0(r.newsletter.regresos)} regresos al blog</span>`)}</tr>
</table></td></tr>`;

  const tarjetasBlogs = conTrafico.slice(0, 8).map((x) => filaBlog(x, maxClics)).join("") +
    (sinTrafico ? `<tr><td style="padding:0 26px 10px;font-size:12px;color:${NEUTRO};">${sinTrafico} artículo${sinTrafico > 1 ? "s" : ""} sin impresiones esta semana.</td></tr>` : "");

  const consultas = r.consultas.slice(0, 8).map((c) => `<tr><td style="padding:0 26px 8px;font-size:13px;line-height:19px;color:#374151;"><b>${escapar(c.consulta)}</b> <span style="color:${NEUTRO};">— ${n0(c.actual.clicks)} clics · ${n0(c.actual.impressions)} impresiones · posición ${n1(c.actual.position)}</span></td></tr>`).join("");

  const dev = r.dispositivos.map((d) => `${d.dispositivo === "MOBILE" ? "Móvil" : d.dispositivo === "DESKTOP" ? "Escritorio" : "Tablet"}: ${n0(d.clicks)} clics / ${n0(d.impressions)} imp.`).join(" · ");
  const pais = r.paises.slice(0, 5).map((x) => `${x.pais.toUpperCase()}: ${n0(x.clicks)}`).join(" · ");

  const seguimiento = ia?.seguimiento.length
    ? `<tr><td style="padding:2px 26px 8px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${ia.seguimiento.map((s) => `<tr><td style="font-size:14px;line-height:21px;color:#374151;padding-bottom:6px;"><b>${escapar(s.tema)}:</b> ${escapar(s.estado)}</td></tr>`).join("")}</table></td></tr>`
    : "";

  const recs = ia?.recomendaciones.length
    ? ia.recomendaciones.map((x) => `<tr><td style="padding:0 26px 12px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:12px;"><tr><td style="padding:12px 14px;">
<span style="display:inline-block;background:${CHIP[x.prioridad]};color:#fff;font-size:11px;font-weight:bold;letter-spacing:.8px;text-transform:uppercase;padding:2px 8px;border-radius:999px;">${x.prioridad}</span>
<div style="font-size:15px;line-height:21px;font-weight:bold;color:#111827;margin-top:6px;">${escapar(x.titulo)}</div>
<div style="font-size:14px;line-height:21px;color:#374151;margin-top:4px;">${escapar(x.detalle)}</div>
${x.blog ? `<div style="font-size:12px;color:${NEUTRO};margin-top:4px;">Blog: ${escapar(x.blog)}</div>` : ""}</td></tr></table></td></tr>`).join("")
    : "";

  const pb = ia?.proximo_blog;
  const cierre = ia && (ia.conclusion || pb)
    ? `<tr><td style="padding:22px 26px 6px;border-top:3px solid ${DORADO};"><div style="font-size:12px;letter-spacing:1.2px;text-transform:uppercase;color:${DORADO};font-weight:bold;">Conclusión y próximos pasos</div></td></tr>
${ia.conclusion ? `<tr><td style="padding:2px 26px 12px;font-size:15px;line-height:24px;color:#111827;">${escapar(ia.conclusion)}</td></tr>` : ""}
${pb ? `<tr><td style="padding:0 26px 14px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${VERDE};border-radius:16px;"><tr><td style="padding:20px 20px 22px;">
<div style="font-size:12px;letter-spacing:1.2px;text-transform:uppercase;color:${DORADO};font-weight:bold;">📝 El próximo blog que deberíamos escribir</div>
<div style="font-size:21px;line-height:27px;font-weight:bold;color:#ffffff;margin:6px 0 10px;">${escapar(pb.titulo)}</div>
${pb.palabra_clave ? `<div style="display:inline-block;background:#ffffff22;color:#ffffff;font-size:12px;padding:3px 10px;border-radius:999px;margin-bottom:10px;">Palabra clave: ${escapar(pb.palabra_clave)}</div>` : ""}
${pb.por_que ? `<div style="font-size:14px;line-height:22px;color:#e5f0ee;margin-bottom:8px;"><b style="color:#ffffff;">Por qué:</b> ${escapar(pb.por_que)}</div>` : ""}
${pb.enfoque ? `<div style="font-size:14px;line-height:22px;color:#e5f0ee;margin-bottom:8px;"><b style="color:#ffffff;">Enfoque:</b> ${escapar(pb.enfoque)}</div>` : ""}
${pb.puntos.length ? `<div style="font-size:14px;line-height:22px;color:#e5f0ee;"><b style="color:#ffffff;">Estructura sugerida:</b><br>${pb.puntos.map((x, i) => `${i + 1}. ${escapar(x)}`).join("<br>")}</div>` : ""}
${pb.enlazar_a.length ? `<div style="font-size:13px;line-height:20px;color:#bcd6d1;margin-top:10px;">Enlazar a: ${pb.enlazar_a.map(escapar).join(" · ")}</div>` : ""}
</td></tr></table></td></tr>` : ""}
${ia.alternativas.length ? `<tr><td style="padding:0 26px 8px;font-size:13px;color:${NEUTRO};font-weight:bold;">Otras opciones si prefieres:</td></tr>${ia.alternativas.map((x) => `<tr><td style="padding:0 26px 8px;font-size:14px;line-height:21px;color:#374151;">• <b>${escapar(x.titulo)}</b> — ${escapar(x.por_que)}</td></tr>`).join("")}` : ""}`
    : "";

  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f5f4;font-family:Arial,Helvetica,sans-serif;color:#1f2937;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f5f4;padding:20px 8px;"><tr><td align="center">
<table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:#ffffff;border-radius:18px;overflow:hidden;">
<tr><td style="background:${VERDE};padding:24px 26px;"><div style="font-size:12px;letter-spacing:1.4px;text-transform:uppercase;color:${DORADO};font-weight:bold;">Informe interno · Soy Proceso</div>
<div style="font-size:24px;line-height:30px;font-weight:bold;color:#ffffff;margin-top:4px;">${opts.prueba ? "[PRUEBA] " : ""}Rendimiento del blog en Google</div>
<div style="font-size:14px;color:#ffffffcc;margin-top:4px;">${rango} · comparado con ${fmtRango(r.anterior.inicio, r.anterior.fin)}</div></td></tr>
<tr><td style="height:4px;background:${DORADO};font-size:0;line-height:4px;">&nbsp;</td></tr>
<tr><td style="padding:18px 0 0;"></td></tr>
${veredictoBox}
${kpis}
${graficaDiaria(r.serie, "clicks", "Clics por día")}
${graficaDiaria(r.serie, "impressions", "Impresiones por día")}
${seccion("Qué blogs puntúan", tarjetasBlogs || `<tr><td style="padding:0 26px 10px;font-size:14px;color:${NEUTRO};">Todavía no hay impresiones de los blogs en este periodo.</td></tr>`)}
${seccion("Qué busca la gente y llega a tu sitio", consultas)}
${ia?.mejoras.length ? seccion("✅ Lo que mejoró", ul(ia.mejoras, OK)) : ""}
${ia?.alertas.length ? seccion("⚠️ Alertas", ul(ia.alertas, MAL)) : ""}
${ia?.seguimiento.length ? seccion("Seguimiento de lo que recomendamos la semana pasada", seguimiento) : ""}
${recs ? seccion("Recomendaciones para esta semana", recs) : ""}
${ia?.ideas_contenido.length ? seccion("Ideas de contenido (según las búsquedas reales)", ul(ia.ideas_contenido, DORADO)) : ""}
${seccion("Contexto", `<tr><td style="padding:0 26px 10px;font-size:13px;line-height:20px;color:#374151;">${dev ? `<b>Dispositivos:</b> ${dev}<br>` : ""}${pais ? `<b>Países (clics):</b> ${pais}<br>` : ""}<b>Indexación:</b> ${r.indexacion.indexados} de ${r.indexacion.total} artículos indexados.</td></tr>`)}
${cierre}
<tr><td align="center" style="padding:14px 26px 22px;"><a href="${SITIO}/admin/dashboard" style="display:inline-block;background:${VERDE};color:#ffffff;text-decoration:none;font-weight:bold;font-size:14px;padding:12px 24px;border-radius:999px;">Ver detalle en el panel</a></td></tr>
<tr><td style="padding:16px 26px 24px;border-top:1px solid #e5e7eb;font-size:12px;line-height:18px;color:${NEUTRO};">Informe interno automático, solo para el equipo de Soy Proceso. Datos de Google Search Console (llegan con ~2 días de retraso). Análisis y recomendaciones generados con IA a partir de esos datos: úsalos como guía y valídalos antes de decidir.</td></tr>
</table></td></tr></table></body></html>`;

  const asunto = `${opts.prueba ? "[PRUEBA] " : ""}${emoji} Informe semanal del blog (${rango}): ${veredicto === "igual" ? "sin cambios" : veredicto}`;
  return { html, veredicto, asunto };
}

export function informeTelegram(r: Rendimiento, ia: AnalisisIA | null, veredicto: string): string {
  const a = r.totales.actual, p = r.totales.anterior;
  const flecha = (x: number, y: number) => (x > y ? "▲" : x < y ? "▼" : "=");
  const top = r.paginas.filter((x) => x.tipo === "blog" && x.actual.clicks > 0).slice(0, 3)
    .map((x) => `• ${escapar(corta(x.titulo, 60))}: ${x.actual.clicks} clics`).join("\n");
  const prox = ia?.proximo_blog ? `\n\n📝 <b>Próximo blog sugerido</b>\n${escapar(ia.proximo_blog.titulo)}\n${escapar(corta(ia.proximo_blog.por_que, 220))}` : "";
  const rec = ia?.recomendaciones.slice(0, 3).map((x) => `• [${x.prioridad}] ${escapar(x.titulo)}`).join("\n");
  const emoji = veredicto === "mejoró" ? "📈" : veredicto === "empeoró" ? "📉" : "➖";
  return `${emoji} <b>Informe semanal del blog</b> (${r.rango.inicio} → ${r.rango.fin})
${ia?.titular ? escapar(ia.titular) + "\n" : ""}
Clics: <b>${n0(a.clicks)}</b> ${flecha(a.clicks, p.clicks)} (antes ${n0(p.clicks)})
Impresiones: <b>${n0(a.impressions)}</b> ${flecha(a.impressions, p.impressions)} (antes ${n0(p.impressions)})
Posición media: <b>${a.impressions ? n1(a.position) : "—"}</b> (antes ${p.impressions ? n1(p.position) : "—"})
Leads nuevos: <b>${r.leads.actual}</b> (antes ${r.leads.anterior})
${top ? "\n<b>Top blogs</b>\n" + top : ""}${rec ? "\n\n<b>Recomendaciones</b>\n" + rec : ""}${prox}

El informe completo con gráficas llegó por correo.`;
}
