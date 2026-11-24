// Cliente mínimo de Google Search Console con cuenta de servicio (secret GSC_SERVICE_ACCOUNT_JSON).
// La cuenta de servicio debe ser Propietaria de la propiedad en Search Console.
// OJO: la API NO tiene el botón "Solicitar indexación": solo permite reenviar el sitemap (Sitemaps API)
// y consultar el estado (URL Inspection API, solo lectura).
import { importPKCS8, SignJWT } from "npm:jose@5";

const env = (k: string) => Deno.env.get(k) ?? "";
export const SITE_URL = () => env("GSC_SITE_URL") || "sc-domain:soyproceso.com";

let cache: { token: string; exp: number } | null = null;

export function gscConfigurado(): boolean {
  return !!env("GSC_SERVICE_ACCOUNT_JSON");
}

async function accessToken(): Promise<string> {
  if (cache && cache.exp > Date.now() + 60_000) return cache.token;
  const cred = JSON.parse(env("GSC_SERVICE_ACCOUNT_JSON"));
  const clave = await importPKCS8(String(cred.private_key).replace(/\\n/g, "\n"), "RS256");
  const ahora = Math.floor(Date.now() / 1000);
  const jwt = await new SignJWT({ scope: "https://www.googleapis.com/auth/webmasters" })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(cred.client_email)
    .setSubject(cred.client_email)
    .setAudience("https://oauth2.googleapis.com/token")
    .setIssuedAt(ahora)
    .setExpirationTime(ahora + 3600)
    .sign(clave);
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  });
  if (!r.ok) throw new Error(`Token de Google ${r.status}: ${await r.text()}`);
  const j = await r.json();
  cache = { token: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000 };
  return cache.token;
}

export async function reenviarSitemap(sitemapUrl: string): Promise<string | null> {
  try {
    const t = await accessToken();
    const r = await fetch(
      `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(SITE_URL())}/sitemaps/${encodeURIComponent(sitemapUrl)}`,
      { method: "PUT", headers: { Authorization: `Bearer ${t}` } },
    );
    return r.ok ? null : `Sitemaps API ${r.status}: ${await r.text()}`;
  } catch (e) {
    return `Sitemaps API falló: ${e instanceof Error ? e.message : String(e)}`;
  }
}

export interface FilaAnalytics {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

// Search Analytics (clics, impresiones, CTR, posición). Los datos llevan ~2 días de retraso.
export async function analytics(body: Record<string, unknown>): Promise<FilaAnalytics[]> {
  const t = await accessToken();
  const r = await fetch(
    `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(SITE_URL())}/searchAnalytics/query`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
      body: JSON.stringify({ type: "web", ...body }),
    },
  );
  if (!r.ok) throw new Error(`Search Analytics ${r.status}: ${await r.text()}`);
  const j = await r.json();
  return (j.rows ?? []) as FilaAnalytics[];
}

export interface Inspeccion {
  verdict: string | null;
  coverageState: string | null;
  lastCrawlTime: string | null;
  googleCanonical: string | null;
}

export async function inspeccionarUrl(url: string): Promise<Inspeccion> {
  const t = await accessToken();
  const r = await fetch("https://searchconsole.googleapis.com/v1/urlInspection/index:inspect", {
    method: "POST",
    headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
    body: JSON.stringify({ inspectionUrl: url, siteUrl: SITE_URL(), languageCode: "es" }),
  });
  if (!r.ok) throw new Error(`URL Inspection ${r.status}: ${await r.text()}`);
  const j = await r.json();
  const ix = j?.inspectionResult?.indexStatusResult ?? {};
  return {
    verdict: ix.verdict ?? null,
    coverageState: ix.coverageState ?? null,
    lastCrawlTime: ix.lastCrawlTime ?? null,
    googleCanonical: ix.googleCanonical ?? null,
  };
}

// IndexNow (Bing, Yandex, etc.; Google no lo usa). Requiere INDEXNOW_KEY y el archivo
// https://www.soyproceso.com/<key>.txt con la clave como contenido.
export async function avisarIndexNow(urls: string[]): Promise<string | null> {
  const key = env("INDEXNOW_KEY");
  if (!key) return null;
  const r = await fetch("https://api.indexnow.org/indexnow", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ host: "www.soyproceso.com", key, keyLocation: `https://www.soyproceso.com/${key}.txt`, urlList: urls }),
  });
  return r.ok || r.status === 202 ? null : `IndexNow ${r.status}`;
}
