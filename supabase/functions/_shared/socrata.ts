// Cliente de Socrata (datos.gov.co) para SECOP II.
//
// Usa SODA3 (POST /api/v3/views/{id}/query.json, SoQL completo en el cuerpo) y, si falla,
// vuelve a SODA 2.1 (GET /resource/{id}.json). Reintenta 429 y 5xx con espera creciente y,
// si el token de aplicación es rechazado (401/403), repite la consulta sin token.

const BASE = "https://www.datos.gov.co";
const PAGINA = 1000;

const env = (k: string) => Deno.env.get(k) ?? "";
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface Consulta {
  select: string;
  where: string;
  order?: string;
}

// Cómo le fue al token de aplicación en esta ejecución (se informa en la respuesta de secop-sync).
export const estadoToken = { valor: env("SOCRATA_APP_TOKEN") ? "sin probar" : "sin token" };

async function conReintentos(hacer: (conToken: boolean) => Promise<Response>): Promise<Response> {
  let conToken = Boolean(env("SOCRATA_APP_TOKEN")) && estadoToken.valor !== "rechazado";
  for (let intento = 0; ; intento++) {
    const r = await hacer(conToken);
    if ((r.status === 401 || r.status === 403) && conToken) {
      estadoToken.valor = "rechazado";
      conToken = false;
      continue;
    }
    if (r.ok && conToken) estadoToken.valor = "aceptado";
    if ((r.status === 429 || r.status >= 500) && intento < 3) {
      await r.body?.cancel();
      await dormir(1000 * 2 ** intento);
      continue;
    }
    return r;
  }
}

function cabeceras(conToken: boolean): Record<string, string> {
  const h: Record<string, string> = { Accept: "application/json", "Content-Type": "application/json" };
  if (conToken) h["X-App-Token"] = env("SOCRATA_APP_TOKEN");
  return h;
}

async function paginaSoda3<T>(dataset: string, c: Consulta, pagina: number): Promise<T[]> {
  const query = `SELECT ${c.select} WHERE ${c.where} ORDER BY ${c.order ?? ":id"}`;
  const r = await conReintentos((conToken) =>
    fetch(`${BASE}/api/v3/views/${dataset}/query.json`, {
      method: "POST",
      headers: cabeceras(conToken),
      body: JSON.stringify({ query, page: { pageNumber: pagina, pageSize: PAGINA }, includeSynthetic: false }),
      signal: AbortSignal.timeout(60_000),
    })
  );
  if (!r.ok) throw new Error(`SODA3 ${dataset} respondió ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return (await r.json()) as T[];
}

async function paginaSoda2<T>(dataset: string, c: Consulta, pagina: number): Promise<T[]> {
  const url = new URL(`${BASE}/resource/${dataset}.json`);
  url.searchParams.set("$select", c.select);
  url.searchParams.set("$where", c.where);
  url.searchParams.set("$order", c.order ?? ":id");
  url.searchParams.set("$limit", String(PAGINA));
  url.searchParams.set("$offset", String((pagina - 1) * PAGINA));
  const r = await conReintentos((conToken) =>
    fetch(url, { headers: cabeceras(conToken), signal: AbortSignal.timeout(60_000) })
  );
  if (!r.ok) throw new Error(`Socrata ${dataset} respondió ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return (await r.json()) as T[];
}

// Trae todas las páginas de una consulta.
export async function consultar<T>(dataset: string, c: Consulta): Promise<T[]> {
  const filas: T[] = [];
  let usarSoda3 = true;
  for (let pagina = 1; ; pagina++) {
    let lote: T[];
    try {
      lote = usarSoda3 ? await paginaSoda3<T>(dataset, c, pagina) : await paginaSoda2<T>(dataset, c, pagina);
    } catch (e) {
      if (!usarSoda3) throw e;
      console.warn(`SODA3 falló, se usa SODA 2.1: ${e instanceof Error ? e.message : e}`);
      usarSoda3 = false;
      lote = await paginaSoda2<T>(dataset, c, pagina);
    }
    filas.push(...lote);
    if (lote.length < PAGINA) return filas;
  }
}

// Momento (epoch en segundos) de la última recarga del dataset. Sirve para no repetir
// la lectura completa cuando Socrata no ha cambiado nada desde la corrida anterior.
export async function ultimaRecarga(dataset: string): Promise<number | null> {
  try {
    const r = await fetch(`${BASE}/api/views/${dataset}.json`, { signal: AbortSignal.timeout(15_000) });
    if (!r.ok) return null;
    const meta = await r.json();
    return typeof meta.rowsUpdatedAt === "number" ? meta.rowsUpdatedAt : null;
  } catch {
    return null;
  }
}

// Lista SoQL segura: los ids de SECOP solo llevan letras, números, puntos y guiones.
export function listaIds(ids: string[]): string {
  return ids
    .filter((id) => /^[A-Za-z0-9._-]{1,64}$/.test(id))
    .map((id) => `'${id}'`)
    .join(",");
}
