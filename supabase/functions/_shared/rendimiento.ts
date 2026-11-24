// Rendimiento en Google (Search Console API) de los blogs: clics, impresiones, CTR y posición,
// comparado con el periodo anterior de la misma duración, más leads y newsletter del mismo rango.
import { analytics, type FilaAnalytics } from "./gsc.ts";
import { SITIO } from "./blog-utils.ts";

export interface Metricas {
  clicks: number;
  impressions: number;
  ctr: number; // 0..1
  position: number;
}
export interface FilaPagina {
  url: string;
  ruta: string;
  slug: string | null;
  titulo: string;
  tipo: "blog" | "inicio" | "otra";
  actual: Metricas;
  anterior: Metricas;
  leads: number;
}
export interface Consulta {
  consulta: string;
  actual: Metricas;
  anterior: Metricas | null;
}
export interface Rendimiento {
  rango: { inicio: string; fin: string; dias: number };
  anterior: { inicio: string; fin: string };
  totales: { actual: Metricas; anterior: Metricas };
  paginas: FilaPagina[];
  serie: { fecha: string; clicks: number; impressions: number; clicksPrev: number; impressionsPrev: number }[];
  consultas: Consulta[];
  dispositivos: { dispositivo: string; clicks: number; impressions: number }[];
  paises: { pais: string; clicks: number; impressions: number }[];
  leads: { actual: number; anterior: number; porBlog: { slug: string; titulo: string; n: number }[] };
  newsletter: { enviados: number; abiertos: number; clics: number; regresos: number };
  indexacion: { indexados: number; total: number };
}

export const DIA_MS = 86_400_000;
export const fmtFecha = (d: Date) => d.toISOString().slice(0, 10);
const sumaDias = (f: string, n: number) => fmtFecha(new Date(new Date(f + "T00:00:00Z").getTime() + n * DIA_MS));
const diasEntre = (a: string, b: string) => Math.round((new Date(b + "T00:00:00Z").getTime() - new Date(a + "T00:00:00Z").getTime()) / DIA_MS) + 1;
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

// Fin por defecto: hace 2 días (Google tarda en consolidar los datos).
export function calcularRangos(dias = 28, inicio?: string, fin?: string) {
  let f = fin && FECHA_RE.test(fin) ? fin : sumaDias(fmtFecha(new Date()), -2);
  const maxFin = sumaDias(fmtFecha(new Date()), -1);
  if (f > maxFin) f = maxFin;
  let i = inicio && FECHA_RE.test(inicio) ? inicio : sumaDias(f, -(Math.min(Math.max(dias, 1), 480) - 1));
  if (i > f) i = f;
  if (diasEntre(i, f) > 480) i = sumaDias(f, -479);
  const n = diasEntre(i, f);
  const finPrev = sumaDias(i, -1);
  const iniPrev = sumaDias(finPrev, -(n - 1));
  return { inicio: i, fin: f, dias: n, iniPrev, finPrev };
}

const vacio = (): Metricas => ({ clicks: 0, impressions: 0, ctr: 0, position: 0 });
const aM = (r?: FilaAnalytics | null): Metricas =>
  r ? { clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position } : vacio();

// Normaliza la URL: quita el dominio y deja la ruta. Solo cuenta el sitio con www.
function ruta(url: string): string {
  return url.replace(SITIO, "") || "/";
}

// deno-lint-ignore no-explicit-any
export async function obtenerRendimiento(sb: any, p: { dias?: number; inicio?: string; fin?: string }): Promise<Rendimiento> {
  const r = calcularRangos(p.dias ?? 28, p.inicio, p.fin);
  const act = { startDate: r.inicio, endDate: r.fin };
  const prev = { startDate: r.iniPrev, endDate: r.finPrev };

  const [totA, totP, pagA, pagP, serA, serP, conA, conP, dev, pais] = await Promise.all([
    analytics({ ...act }),
    analytics({ ...prev }),
    analytics({ ...act, dimensions: ["page"], rowLimit: 1000 }),
    analytics({ ...prev, dimensions: ["page"], rowLimit: 1000 }),
    analytics({ ...act, dimensions: ["date"], rowLimit: 500 }),
    analytics({ ...prev, dimensions: ["date"], rowLimit: 500 }),
    analytics({ ...act, dimensions: ["query"], rowLimit: 30 }),
    analytics({ ...prev, dimensions: ["query"], rowLimit: 1000 }),
    analytics({ ...act, dimensions: ["device"] }),
    analytics({ ...act, dimensions: ["country"], rowLimit: 6 }),
  ]);

  // Artículos publicados (aparecen aunque tengan 0 impresiones).
  const { data: posts } = await sb.from("blog_posts").select("id,title,slug").eq("status", "published");
  const titulos = new Map<string, string>((posts ?? []).map((x: { slug: string; title: string }) => [x.slug, x.title]));

  // Leads verificados dentro del rango (y del anterior).
  const desde = (f: string) => f + "T00:00:00Z";
  const hasta = (f: string) => sumaDias(f, 1) + "T00:00:00Z";
  const { data: leadsA } = await sb.from("blog_subscribers").select("source_slug")
    .not("verified_at", "is", null).gte("verified_at", desde(r.inicio)).lt("verified_at", hasta(r.fin));
  const { count: leadsP } = await sb.from("blog_subscribers").select("id", { count: "exact", head: true })
    .not("verified_at", "is", null).gte("verified_at", desde(r.iniPrev)).lt("verified_at", hasta(r.finPrev));
  const porSlug = new Map<string, number>();
  for (const l of leadsA ?? []) porSlug.set(l.source_slug ?? "(sin blog)", (porSlug.get(l.source_slug ?? "(sin blog)") ?? 0) + 1);

  // Newsletter del rango.
  const { data: envios } = await sb.from("blog_email_sends").select("status,opened_at,clicked_at,returned_at")
    .gte("created_at", desde(r.inicio)).lt("created_at", hasta(r.fin));
  const news = { enviados: 0, abiertos: 0, clics: 0, regresos: 0 };
  for (const e of envios ?? []) {
    if (e.status === "sent") news.enviados++;
    if (e.opened_at) news.abiertos++;
    if (e.clicked_at) news.clics++;
    if (e.returned_at) news.regresos++;
  }

  const { data: idx } = await sb.from("blog_index_status").select("indexed");

  // Páginas: unión de lo que Google devolvió y de los artículos publicados.
  const mapa = new Map<string, FilaPagina>();
  const crear = (rutaUrl: string, url: string): FilaPagina => {
    const m = rutaUrl.match(/^\/blog\/([^/?#]+)\/?$/);
    const slug = m ? m[1] : null;
    return {
      url, ruta: rutaUrl, slug,
      titulo: slug ? (titulos.get(slug) ?? slug) : rutaUrl === "/" ? "Página de inicio" : rutaUrl === "/blog" ? "Listado del blog" : rutaUrl,
      tipo: slug ? "blog" : rutaUrl === "/" ? "inicio" : "otra",
      actual: vacio(), anterior: vacio(), leads: slug ? (porSlug.get(slug) ?? 0) : 0,
    };
  };
  for (const f of pagA) {
    const u = f.keys[0];
    if (!u.startsWith(SITIO)) continue; // ignora soyproceso.com sin www y http://
    const rt = ruta(u);
    mapa.set(rt, { ...crear(rt, u), actual: aM(f) });
  }
  for (const f of pagP) {
    const u = f.keys[0];
    if (!u.startsWith(SITIO)) continue;
    const rt = ruta(u);
    const x = mapa.get(rt) ?? crear(rt, u);
    x.anterior = aM(f);
    mapa.set(rt, x);
  }
  for (const [slug] of titulos) {
    const rt = `/blog/${slug}`;
    if (!mapa.has(rt)) mapa.set(rt, crear(rt, `${SITIO}${rt}`));
  }

  // Serie diaria completa (rellena días sin datos con 0), alineada día a día con el periodo anterior.
  const mA = new Map(serA.map((f) => [f.keys[0], f]));
  const mP = new Map(serP.map((f) => [f.keys[0], f]));
  const serie = [];
  for (let k = 0; k < r.dias; k++) {
    const fa = sumaDias(r.inicio, k), fp = sumaDias(r.iniPrev, k);
    serie.push({
      fecha: fa, clicks: mA.get(fa)?.clicks ?? 0, impressions: mA.get(fa)?.impressions ?? 0,
      clicksPrev: mP.get(fp)?.clicks ?? 0, impressionsPrev: mP.get(fp)?.impressions ?? 0,
    });
  }

  const prevCon = new Map(conP.map((f) => [f.keys[0], aM(f)]));
  const consultas: Consulta[] = conA.map((f) => ({ consulta: f.keys[0], actual: aM(f), anterior: prevCon.get(f.keys[0]) ?? null }));

  return {
    rango: { inicio: r.inicio, fin: r.fin, dias: r.dias },
    anterior: { inicio: r.iniPrev, fin: r.finPrev },
    totales: { actual: aM(totA[0]), anterior: aM(totP[0]) },
    paginas: [...mapa.values()].sort((a, b) => b.actual.clicks - a.actual.clicks || b.actual.impressions - a.actual.impressions),
    serie,
    consultas,
    dispositivos: dev.map((f) => ({ dispositivo: f.keys[0], clicks: f.clicks, impressions: f.impressions })),
    paises: pais.map((f) => ({ pais: f.keys[0], clicks: f.clicks, impressions: f.impressions })),
    leads: {
      actual: (leadsA ?? []).length,
      anterior: leadsP ?? 0,
      porBlog: [...porSlug.entries()].map(([slug, n]) => ({ slug, titulo: titulos.get(slug) ?? slug, n })).sort((a, b) => b.n - a.n),
    },
    newsletter: news,
    indexacion: { indexados: (idx ?? []).filter((i: { indexed: boolean }) => i.indexed).length, total: (idx ?? []).length },
  };
}

// Consultas de búsqueda que llevan a una página concreta.
export async function consultasDePagina(url: string, inicio: string, fin: string) {
  const r = calcularRangos(28, inicio, fin);
  const filas = await analytics({
    startDate: r.inicio, endDate: r.fin, dimensions: ["query"], rowLimit: 15,
    dimensionFilterGroups: [{ filters: [{ dimension: "page", operator: "equals", expression: url }] }],
  });
  return filas.map((f) => ({ consulta: f.keys[0], ...aM(f) }));
}
