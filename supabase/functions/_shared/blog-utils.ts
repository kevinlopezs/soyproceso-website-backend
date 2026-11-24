// Utilidades puras del flujo de leads del blog (sin red ni base de datos, para poder probarlas).

export const SITIO = "https://www.soyproceso.com";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
const DOMINIOS_DESECHABLES = new Set([
  "mailinator.com", "yopmail.com", "guerrillamail.com", "10minutemail.com", "tempmail.com",
  "temp-mail.org", "trashmail.com", "sharklasers.com", "getnada.com", "maildrop.cc",
  "dispostable.com", "fakeinbox.com", "throwawaymail.com", "emailondeck.com", "mintemail.com",
]);

// Mismas reglas que cotizador-lead.
export function emailValido(email: string): boolean {
  const e = email.trim().toLowerCase();
  if (!EMAIL_RE.test(e) || e.length > 254) return false;
  return !DOMINIOS_DESECHABLES.has(e.split("@")[1]);
}

export function texto(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim().slice(0, max);
  return t || null;
}

// ---- OTP de 6 dígitos ------------------------------------------------------------------

export function generarOtp(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  return String(n).padStart(6, "0");
}

export function generarSalt(): string {
  return crypto.randomUUID().replaceAll("-", "");
}

export async function hashOtp(codigo: string, salt: string): Promise<string> {
  const datos = new TextEncoder().encode(`${salt}:${codigo}`);
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", datos));
  return Array.from(h, (b) => b.toString(16).padStart(2, "0")).join("");
}

// Comparación en tiempo constante.
export function igualesSeguro(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// ---- Redirecciones del tracking (evita open redirect) -----------------------------------

export function urlPermitida(u: string): boolean {
  try {
    const url = new URL(u);
    return url.protocol === "https:" && (url.hostname === "www.soyproceso.com" || url.hostname === "soyproceso.com");
  } catch {
    return false;
  }
}

export function conParametros(u: string, params: Record<string, string>): string {
  const url = new URL(u);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

// ---- Texto del correo ---------------------------------------------------------------------

export function resumenPost(excerpt: string | null, contenido: string | null, max = 200): string {
  const base = (excerpt && excerpt.trim()) ||
    (contenido ?? "").replace(/<[^>]*>/g, " ").replace(/[#*_`>\[\]()!-]+/g, " ");
  const limpio = base.replace(/\s+/g, " ").trim();
  return limpio.length > max ? limpio.slice(0, max).replace(/\s+\S*$/, "") + "…" : limpio;
}

// ---- Search Console -----------------------------------------------------------------------

export function urlDePost(slug: string): string {
  return `${SITIO}/blog/${slug}`;
}

export function urlInspeccionGsc(url: string, siteUrl = "sc-domain:soyproceso.com"): string {
  return `https://search.google.com/search-console/inspect?resource_id=${encodeURIComponent(siteUrl)}&id=${encodeURIComponent(url)}`;
}

// Traduce el coverageState de la URL Inspection API (puede venir en inglés o español).
export function traducirCobertura(estado: string | null | undefined, veredicto?: string | null): string {
  const e = (estado ?? "").toLowerCase();
  if (!e) return veredicto === "PASS" ? "Indexada" : "Sin información de Google";
  if (e.includes("submitted and indexed") || e.includes("enviada e indexada")) return "Indexada";
  if (e.includes("indexed, not submitted") || e.includes("indexada, no enviada")) return "Indexada (fuera del sitemap)";
  if (e.includes("crawled") && e.includes("not indexed")) return "Rastreada, pero Google decidió no indexarla";
  if (e.includes("discovered") && e.includes("not indexed")) return "Descubierta, aún sin rastrear";
  if (e.includes("alternate page") || e.includes("canonical")) return "Duplicada: Google eligió otra URL como canónica";
  if (e.includes("redirect")) return "Es una redirección";
  if (e.includes("404") || e.includes("not found")) return "Error 404 (no existe)";
  if (e.includes("noindex")) return "Bloqueada por etiqueta noindex";
  if (e.includes("robots")) return "Bloqueada por robots.txt";
  if (e.includes("soft 404")) return "Soft 404";
  if (e.includes("unknown to google") || e.includes("url is unknown") || e.includes("desconocida")) return "Google aún no conoce esta URL";
  return estado as string;
}

export function estaIndexada(veredicto?: string | null, estado?: string | null): boolean {
  if (veredicto !== "PASS") return false;
  return traducirCobertura(estado, veredicto).startsWith("Indexada");
}
