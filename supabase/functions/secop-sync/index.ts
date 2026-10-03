// Sincroniza SECOP II (datos abiertos de Socrata) con Supabase y avisa por Telegram y correo.
//
// Pasos de cada corrida:
//   1. Trae los procesos psicosociales publicados en la ventana (SECOP_VENTANA_DIAS) y los que
//      el equipo sigue aunque sean más viejos.
//   2. Compara contra la copia guardada: procesos nuevos y cambios de fase, estado, ofertas, etc.
//      (Socrata recarga el dataset completo cada día, así que el cambio se detecta aquí.)
//   3. Lista los documentos de los procesos aptos y descarga los pendientes al bucket privado.
//   4. Crea recordatorios de cierre para los procesos marcados "ofertar".
//   5. Envía un solo aviso con todo lo pendiente.
//
// Se invoca desde pg_cron (cabecera x-cron-secret) o desde el panel de admin (sesión del equipo).

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  aFila,
  diferencias,
  ETIQUETAS_CAMPO,
  type Fila,
  type ProcesoSocrata,
  whereDescubrimiento,
} from "../_shared/secop-rules.ts";
import { type Aviso, escapar, notificar } from "../_shared/notify.ts";

const SOCRATA = "https://www.datos.gov.co/resource";
const DATASET_PROCESOS = "p6dx-8zbt";
const DATASET_DOCUMENTOS = "dmgg-8hin";
const SEGUIMIENTO_ACTIVO = ["revisando", "ofertar", "ofertado"];
// SECOP II bloquea descargas sin un navegador conocido.
const UA_NAVEGADOR =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129 Safari/537.36";

const env = (k: string, def = "") => Deno.env.get(k) ?? def;
const VENTANA_DIAS = Number(env("SECOP_VENTANA_DIAS", "45"));
const MAX_DESCARGAS = Number(env("SECOP_MAX_DESCARGAS", "6"));
const MAX_MB = 25;
const PANEL_URL = env("SECOP_PANEL_URL", "https://www.soyproceso.com/admin/dashboard");

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));
const trozos = <T>(xs: T[], n: number) =>
  Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));
const sqlLista = (xs: string[]) => xs.map((x) => `'${x.replace(/'/g, "''")}'`).join(",");

async function socrata<T>(dataset: string, where: string, select?: string): Promise<T[]> {
  const filas: T[] = [];
  for (let offset = 0; ; offset += 1000) {
    const url = new URL(`${SOCRATA}/${dataset}.json`);
    url.searchParams.set("$where", where);
    url.searchParams.set("$limit", "1000");
    url.searchParams.set("$offset", String(offset));
    url.searchParams.set("$order", ":id");
    if (select) url.searchParams.set("$select", select);
    const r = await fetch(url, {
      headers: { "X-App-Token": env("SOCRATA_APP_TOKEN") },
      signal: AbortSignal.timeout(60_000),
    });
    if (!r.ok) throw new Error(`Socrata ${dataset} respondió ${r.status}: ${await r.text()}`);
    const pagina = (await r.json()) as T[];
    filas.push(...pagina);
    if (pagina.length < 1000) return filas;
  }
}

async function autorizado(req: Request, db: SupabaseClient): Promise<boolean> {
  const secreto = env("SECOP_CRON_SECRET");
  if (secreto && req.headers.get("x-cron-secret") === secreto) return true;
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return false;
  const { data } = await db.auth.getUser(token);
  return Boolean(data.user);
}

const cop = (n: number | null) =>
  n === null ? "sin dato" : new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(n);

function valorLegible(campo: string, v: string | null): string {
  if (v === null || v === "") return "—";
  if (["precio_base", "valor_adjudicado"].includes(campo)) return cop(Number(v));
  if (campo === "adjudicado") return v === "true" ? "Sí" : "No";
  if (campo === "fecha_ultima_publicacion") return v.slice(0, 10);
  return v;
}

interface EventoPendiente {
  id: number;
  id_proceso: string;
  tipo: string;
  campo: string | null;
  valor_antes: string | null;
  valor_ahora: string | null;
  secop_procesos: Pick<Fila, "entidad" | "referencia" | "descripcion" | "precio_base" | "modalidad" | "ciudad" | "url" | "categoria"> & {
    fecha_cierre: string | null;
  };
}

function armarAviso(eventos: EventoPendiente[]): Aviso | null {
  if (eventos.length === 0) return null;
  const grupos = {
    nuevo: eventos.filter((e) => e.tipo === "nuevo"),
    cambio: eventos.filter((e) => e.tipo === "cambio"),
    documento: eventos.filter((e) => e.tipo === "documento"),
    recordatorio: eventos.filter((e) => e.tipo === "recordatorio_cierre"),
  };
  const tg: string[] = ["<b>SECOP · Soy Proceso</b>"];
  const html: string[] = [`<h2 style="color:#0f4c47;font-family:Arial,sans-serif">SECOP · Soy Proceso</h2>`];
  const txt: string[] = ["SECOP · Soy Proceso"];
  const enlace = (e: EventoPendiente) => e.secop_procesos.url ?? PANEL_URL;
  const titulo = (e: EventoPendiente) =>
    `${e.secop_procesos.entidad ?? "Entidad"}${e.secop_procesos.referencia ? ` (${e.secop_procesos.referencia})` : ""}`;

  if (grupos.recordatorio.length) {
    tg.push("", `⏰ <b>Cierran pronto (${grupos.recordatorio.length})</b>`);
    html.push(`<h3>Cierran pronto</h3><ul>`);
    txt.push("", "CIERRAN PRONTO");
    for (const e of grupos.recordatorio) {
      const cierre = e.valor_ahora ?? "";
      tg.push(`• <a href="${enlace(e)}">${escapar(titulo(e))}</a>: cierra ${escapar(cierre)}`);
      html.push(`<li><a href="${enlace(e)}">${escapar(titulo(e))}</a>: cierra ${escapar(cierre)}</li>`);
      txt.push(`- ${titulo(e)}: cierra ${cierre} ${enlace(e)}`);
    }
    html.push("</ul>");
  }

  if (grupos.nuevo.length) {
    tg.push("", `🆕 <b>Procesos nuevos aptos (${grupos.nuevo.length})</b>`);
    html.push(`<h3>Procesos nuevos aptos (${grupos.nuevo.length})</h3><ul>`);
    txt.push("", `PROCESOS NUEVOS APTOS (${grupos.nuevo.length})`);
    for (const e of grupos.nuevo) {
      const p = e.secop_procesos;
      const objeto = (p.descripcion ?? "").slice(0, 160);
      const meta = `${cop(p.precio_base)} · ${p.modalidad ?? ""} · ${p.ciudad ?? ""}`;
      tg.push(`• <a href="${enlace(e)}">${escapar(titulo(e))}</a>\n  ${escapar(objeto)}\n  <i>${escapar(meta)}</i>`);
      html.push(`<li><a href="${enlace(e)}"><b>${escapar(titulo(e))}</b></a><br>${escapar(objeto)}<br><i>${escapar(meta)}</i></li>`);
      txt.push(`- ${titulo(e)}: ${objeto} (${meta}) ${enlace(e)}`);
    }
    html.push("</ul>");
  }

  if (grupos.cambio.length) {
    tg.push("", `🔄 <b>Cambios en procesos (${grupos.cambio.length})</b>`);
    html.push(`<h3>Cambios en procesos</h3><ul>`);
    txt.push("", "CAMBIOS EN PROCESOS");
    for (const e of grupos.cambio) {
      const campo = e.campo ?? "";
      const linea = `${ETIQUETAS_CAMPO[campo] ?? campo}: ${valorLegible(campo, e.valor_antes)} → ${valorLegible(campo, e.valor_ahora)}`;
      tg.push(`• <a href="${enlace(e)}">${escapar(titulo(e))}</a>: ${escapar(linea)}`);
      html.push(`<li><a href="${enlace(e)}">${escapar(titulo(e))}</a>: ${escapar(linea)}</li>`);
      txt.push(`- ${titulo(e)}: ${linea}`);
    }
    html.push("</ul>");
  }

  if (grupos.documento.length) {
    tg.push("", `📎 <b>Documentos nuevos (${grupos.documento.length})</b>`);
    html.push(`<h3>Documentos nuevos (adendas, respuestas, informes)</h3><ul>`);
    txt.push("", "DOCUMENTOS NUEVOS");
    for (const e of grupos.documento) {
      tg.push(`• <a href="${enlace(e)}">${escapar(titulo(e))}</a>: ${escapar(e.valor_ahora ?? "")}`);
      html.push(`<li><a href="${enlace(e)}">${escapar(titulo(e))}</a>: ${escapar(e.valor_ahora ?? "")}</li>`);
      txt.push(`- ${titulo(e)}: ${e.valor_ahora ?? ""}`);
    }
    html.push("</ul>");
  }

  tg.push("", `<a href="${PANEL_URL}">Abrir el panel</a>`);
  html.push(`<p><a href="${PANEL_URL}">Abrir el panel de licitaciones</a></p>`);
  txt.push("", `Panel: ${PANEL_URL}`);

  const partes = [
    grupos.nuevo.length && `${grupos.nuevo.length} nuevos`,
    grupos.cambio.length && `${grupos.cambio.length} cambios`,
    grupos.documento.length && `${grupos.documento.length} documentos`,
    grupos.recordatorio.length && `${grupos.recordatorio.length} cierres próximos`,
  ].filter(Boolean);
  return {
    asunto: `SECOP: ${partes.join(", ")}`,
    html: `<div style="font-family:Arial,sans-serif;font-size:14px;color:#111827">${html.join("\n")}</div>`,
    telegram: tg.join("\n"),
    texto: txt.join("\n"),
  };
}

async function sincronizar(db: SupabaseClient) {
  const resumen = { leidos: 0, nuevos: 0, cambios: 0, documentos: 0, descargas: 0 };
  const ahora = new Date();
  const desde = new Date(ahora.getTime() - VENTANA_DIAS * 864e5).toISOString().slice(0, 10);

  // 1. Procesos de la ventana + los que el equipo sigue fuera de ella.
  const crudos = await socrata<ProcesoSocrata>(DATASET_PROCESOS, whereDescubrimiento(desde));
  const { data: seguidos } = await db
    .from("secop_procesos")
    .select("id_proceso")
    .in("seguimiento", SEGUIMIENTO_ACTIVO)
    .lt("fecha_publicacion", desde);
  for (const lote of trozos((seguidos ?? []).map((s) => s.id_proceso as string), 100)) {
    crudos.push(...(await socrata<ProcesoSocrata>(DATASET_PROCESOS, `id_del_proceso in (${sqlLista(lote)})`)));
  }
  const porId = new Map<string, Fila>();
  for (const p of crudos) if (p.id_del_proceso) porId.set(p.id_del_proceso, aFila(p));
  const filas = [...porId.values()];
  resumen.leidos = filas.length;

  // 2. Comparar contra lo guardado.
  const { count } = await db.from("secop_procesos").select("id_proceso", { count: "exact", head: true });
  const primeraCarga = (count ?? 0) === 0;
  const guardados = new Map<string, Fila & { seguimiento: string }>();
  for (const lote of trozos(filas.map((f) => f.id_proceso), 200)) {
    const { data, error } = await db.from("secop_procesos").select("*").in("id_proceso", lote);
    if (error) throw error;
    for (const g of data ?? []) guardados.set(g.id_proceso, g);
  }

  const eventos: Array<Record<string, unknown>> = [];
  const nuevosIds = new Set<string>();
  for (const f of filas) {
    const antes = guardados.get(f.id_proceso);
    if (!antes) {
      nuevosIds.add(f.id_proceso);
      if (f.apto) {
        resumen.nuevos++;
        // En la primera carga no se avisa proceso por proceso.
        eventos.push({ id_proceso: f.id_proceso, tipo: "nuevo", notificado: primeraCarga });
      }
      continue;
    }
    if (!f.apto || antes.seguimiento === "descartado") continue;
    for (const c of diferencias(antes, f)) {
      resumen.cambios++;
      eventos.push({ id_proceso: f.id_proceso, tipo: "cambio", campo: c.campo, valor_antes: c.antes, valor_ahora: c.ahora });
    }
  }

  const marca = ahora.toISOString();
  for (const lote of trozos(filas.map((f) => ({ ...f, ultima_sincronizacion: marca })), 500)) {
    const { error } = await db.from("secop_procesos").upsert(lote, { onConflict: "id_proceso" });
    if (error) throw error;
  }

  // 3. Documentos de los procesos aptos recientes o en seguimiento.
  const { data: conDocs } = await db
    .from("secop_procesos")
    .select("id_proceso, id_portafolio, seguimiento, fecha_publicacion")
    .eq("apto", true)
    .neq("seguimiento", "descartado")
    .not("id_portafolio", "is", null)
    .or(`seguimiento.in.(${SEGUIMIENTO_ACTIVO.join(",")}),fecha_publicacion.gte.${desde}`);
  const procesoDePortafolio = new Map((conDocs ?? []).map((p) => [p.id_portafolio as string, p.id_proceso as string]));
  const docsRemotos: Array<Record<string, any>> = [];
  for (const lote of trozos([...procesoDePortafolio.keys()], 50)) {
    docsRemotos.push(
      ...(await socrata<Record<string, any>>(
        DATASET_DOCUMENTOS,
        `proceso in (${sqlLista(lote)})`,
        "id_documento,proceso,nombre_archivo,extensi_n,tamanno_archivo,fecha_carga,url_descarga_documento",
      )),
    );
  }
  const idsDocs = docsRemotos.map((d) => d.id_documento as string);
  const docsGuardados = new Set<string>();
  for (const lote of trozos(idsDocs, 300)) {
    const { data } = await db.from("secop_documentos").select("id_documento").in("id_documento", lote);
    for (const d of data ?? []) docsGuardados.add(d.id_documento);
  }
  const docsNuevos = docsRemotos
    .filter((d) => !docsGuardados.has(d.id_documento))
    .map((d) => ({
      id_documento: d.id_documento,
      id_proceso: procesoDePortafolio.get(d.proceso)!,
      nombre: d.nombre_archivo,
      extension: d.extensi_n ?? null,
      tamano: d.tamanno_archivo ? Number(d.tamanno_archivo) : null,
      fecha_carga: d.fecha_carga ?? null,
      url_origen: d.url_descarga_documento?.url ?? null,
    }));
  for (const lote of trozos(docsNuevos, 500)) {
    const { error } = await db.from("secop_documentos").insert(lote);
    if (error) throw error;
  }
  resumen.documentos = docsNuevos.length;
  // Un documento nuevo en un proceso que ya conocíamos suele ser una adenda o una respuesta.
  for (const d of docsNuevos) {
    if (!nuevosIds.has(d.id_proceso) && !primeraCarga) {
      eventos.push({ id_proceso: d.id_proceso, tipo: "documento", valor_ahora: d.nombre });
    }
  }

  // 4. Recordatorios: procesos para ofertar que cierran en las próximas 48 horas.
  const en48h = new Date(ahora.getTime() + 48 * 3600e3).toISOString();
  const { data: porCerrar } = await db
    .from("secop_procesos")
    .select("id_proceso, fecha_cierre")
    .eq("seguimiento", "ofertar")
    .gte("fecha_cierre", marca)
    .lte("fecha_cierre", en48h);
  for (const p of porCerrar ?? []) {
    const { count: yaAvisado } = await db
      .from("secop_eventos")
      .select("id", { count: "exact", head: true })
      .eq("id_proceso", p.id_proceso)
      .eq("tipo", "recordatorio_cierre")
      .gte("creado", new Date(ahora.getTime() - 20 * 3600e3).toISOString());
    if (!yaAvisado) {
      const cierre = new Date(p.fecha_cierre).toLocaleString("es-CO", { timeZone: "America/Bogota" });
      eventos.push({ id_proceso: p.id_proceso, tipo: "recordatorio_cierre", valor_ahora: cierre });
    }
  }

  for (const lote of trozos(eventos, 500)) {
    const { error } = await db.from("secop_eventos").insert(lote);
    if (error) throw error;
  }

  // 5. Descargar documentos pendientes (pocos por corrida para no activar el bloqueo de SECOP).
  const { data: pendientes } = await db
    .from("secop_documentos")
    .select("id_documento, id_proceso, nombre, tamano, url_origen, secop_procesos!inner(seguimiento, apto)")
    .is("storage_path", null)
    .is("error_descarga", null)
    .eq("secop_procesos.apto", true)
    .neq("secop_procesos.seguimiento", "descartado")
    .order("creado", { ascending: true })
    .limit(MAX_DESCARGAS);
  for (const d of pendientes ?? []) {
    let error: string | null = null;
    let path: string | null = null;
    try {
      if (!d.url_origen) throw new Error("Sin enlace de descarga");
      if (d.tamano && d.tamano > MAX_MB * 1024 * 1024) throw new Error(`Pesa más de ${MAX_MB} MB: descargar desde SECOP`);
      const r = await fetch(d.url_origen, { headers: { "User-Agent": UA_NAVEGADOR }, signal: AbortSignal.timeout(90_000) });
      if (!r.ok) throw new Error(`SECOP respondió ${r.status}`);
      const nombreSeguro = d.nombre.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9._-]+/g, "_");
      path = `${d.id_proceso}/${d.id_documento}-${nombreSeguro}`;
      const { error: subida } = await db.storage
        .from("secop-documentos")
        .upload(path, await r.arrayBuffer(), {
          contentType: r.headers.get("content-type") ?? "application/octet-stream",
          upsert: true,
        });
      if (subida) throw subida;
      resumen.descargas++;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      path = null;
    }
    // Un 403 suele ser el bloqueo temporal de SECOP: se reintenta en la próxima corrida.
    const reintentar = error?.includes("respondió 403");
    await db
      .from("secop_documentos")
      .update({ storage_path: path, error_descarga: reintentar ? null : error })
      .eq("id_documento", d.id_documento);
    if (reintentar) break;
    await dormir(2500);
  }

  // 6. Avisar todo lo pendiente.
  const { data: porAvisar, error: errAvisos } = await db
    .from("secop_eventos")
    .select(
      "id, id_proceso, tipo, campo, valor_antes, valor_ahora, secop_procesos!inner(entidad, referencia, descripcion, precio_base, modalidad, ciudad, url, categoria, fecha_cierre)",
    )
    .eq("notificado", false)
    .order("creado", { ascending: true })
    .limit(300);
  if (errAvisos) throw errAvisos;
  const aviso = armarAviso((porAvisar ?? []) as unknown as EventoPendiente[]);
  let erroresAviso: string[] = [];
  if (aviso) {
    erroresAviso = await notificar(aviso);
    // Si al menos un canal funcionó, se marcan como avisados.
    if (erroresAviso.length < 2) {
      await db.from("secop_eventos").update({ notificado: true }).in("id", (porAvisar ?? []).map((e) => e.id));
    }
  } else if (primeraCarga) {
    erroresAviso = await notificar({
      asunto: "SECOP: monitor activado",
      telegram: `<b>SECOP · Soy Proceso</b>\nMonitor activado: ${resumen.nuevos} procesos aptos cargados de los últimos ${VENTANA_DIAS} días.\n<a href="${PANEL_URL}">Ver en el panel</a>`,
      html: `<p>Monitor activado: ${resumen.nuevos} procesos aptos cargados de los últimos ${VENTANA_DIAS} días.</p><p><a href="${PANEL_URL}">Ver en el panel</a></p>`,
      texto: `Monitor activado: ${resumen.nuevos} procesos aptos cargados. ${PANEL_URL}`,
    });
  }
  return { ...resumen, primeraCarga, erroresAviso };
}

Deno.serve(async (req) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  };
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });
  if (!(await autorizado(req, db))) {
    return new Response(JSON.stringify({ error: "No autorizado" }), { status: 401, headers: cors });
  }

  const { data: corrida } = await db.from("secop_sync_runs").insert({}).select("id").single();
  try {
    const r = await sincronizar(db);
    await db
      .from("secop_sync_runs")
      .update({
        fin: new Date().toISOString(),
        ok: true,
        leidos: r.leidos,
        nuevos: r.nuevos,
        cambios: r.cambios,
        documentos: r.documentos,
        descargas: r.descargas,
        error: r.erroresAviso.length ? r.erroresAviso.join(" | ") : null,
      })
      .eq("id", corrida?.id);
    return new Response(JSON.stringify(r), { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (e) {
    const mensaje = e instanceof Error ? e.message : JSON.stringify(e);
    await db.from("secop_sync_runs").update({ fin: new Date().toISOString(), ok: false, error: mensaje }).eq("id", corrida?.id);
    return new Response(JSON.stringify({ error: mensaje }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
