// Sincroniza SECOP II (datos abiertos de Socrata) con Supabase y avisa por Telegram y correo.
//
// Pasos de cada corrida:
//   1. Trae los procesos abiertos de la ventana (SECOP_VENTANA_DIAS) y, por id, los que el equipo
//      sigue. Solo se guardan los aptos y los seguidos. Si Socrata no se ha recargado desde la corrida
//      anterior, la corrida programada se salta los pasos 1 a 3.
//   2. Compara contra la copia guardada: procesos nuevos y cambios de fase, estado, ofertas, etc.
//      (Socrata recarga el dataset completo cada día, así que el cambio se detecta aquí.)
//      Solo se reescriben las filas nuevas o que cambiaron.
//      Lo que dejó de estar abierto y nadie sigue se borra: el panel solo muestra lo vigente.
//   3. Lista los documentos de los procesos aptos y los guarda.
//   4. Recordatorios: cierres de los procesos para ofertar e hitos del cronograma de los que
//      seguimos (el cronograma lo captura el panel desde la ficha pública de SECOP II).
//   5. Descarga documentos pendientes al bucket privado.
//   6. Envía un solo aviso con todo lo pendiente.
//
// Se invoca desde pg_cron (cabecera x-cron-secret) o desde el panel de admin (sesión del equipo).
// Cuerpo opcional: { "modo": "descargas", "id_proceso": "CO1.REQ.x" } baja ya los documentos
// pendientes de un proceso, sin sincronizar lo demás.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  aFila,
  diferencias,
  ETIQUETAS_CAMPO,
  type Fila,
  filaCambio,
  type ProcesoSocrata,
  SELECT_PROCESOS,
  whereDescubrimiento,
} from "../_shared/secop-rules.ts";
import { consultar, estadoToken, listaIds, ultimaRecarga } from "../_shared/socrata.ts";
import { type Aviso, escapar, notificar } from "../_shared/notify.ts";

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

type Origen = "cron" | "panel";

async function autorizado(req: Request, db: SupabaseClient): Promise<Origen | null> {
  const secreto = env("SECOP_CRON_SECRET");
  if (secreto && req.headers.get("x-cron-secret") === secreto) return "cron";
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data } = await db.auth.getUser(token);
  return data.user ? "panel" : null;
}

const cop = (n: number | null) =>
  n === null ? "sin dato" : new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(n);

const horaColombia = (iso: string) =>
  new Date(iso).toLocaleString("es-CO", { timeZone: "America/Bogota", dateStyle: "medium", timeStyle: "short" });

function valorLegible(campo: string, v: string | null): string {
  if (v === null || v === "") return "—";
  if (["precio_base", "valor_adjudicado"].includes(campo)) return cop(Number(v));
  if (campo === "adjudicado") return v === "true" ? "Sí" : "No";
  if (campo === "fecha_ultima_publicacion" || campo === "fecha_recepcion_ofertas") return v.slice(0, 10);
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
  const tg: string[] = ["<b>SECOP · Soy Proceso</b>"];
  const html: string[] = [`<h2 style="color:#0f4c47;font-family:Arial,sans-serif">SECOP · Soy Proceso</h2>`];
  const txt: string[] = ["SECOP · Soy Proceso"];
  const enlace = (e: EventoPendiente) => e.secop_procesos.url ?? PANEL_URL;
  const titulo = (e: EventoPendiente) =>
    `${e.secop_procesos.entidad ?? "Entidad"}${e.secop_procesos.referencia ? ` (${e.secop_procesos.referencia})` : ""}`;

  // Cada grupo: tipo de evento, título y cómo se escribe la línea de un evento.
  const grupos: Array<{ tipo: string; etiqueta: string; titulo: string; emoji: string; linea: (e: EventoPendiente) => string }> = [
    { tipo: "recordatorio_cierre", etiqueta: "Cierre", titulo: "Cierran pronto", emoji: "⏰", linea: (e) => `cierra ${e.valor_ahora ?? ""}` },
    { tipo: "hito", etiqueta: "Hito", titulo: "Hitos del cronograma en las próximas 48 horas", emoji: "📅", linea: (e) => `${e.campo}: ${e.valor_ahora ?? ""}` },
    { tipo: "cronograma", etiqueta: "Cronograma", titulo: "Cambios en el cronograma", emoji: "🗓️", linea: (e) => `${e.campo}: ${e.valor_antes ?? "—"} → ${e.valor_ahora ?? "—"}` },
    {
      tipo: "nuevo",
      etiqueta: "Nuevo",
      titulo: "Procesos nuevos aptos",
      emoji: "🆕",
      linea: (e) => {
        const p = e.secop_procesos;
        return `${(p.descripcion ?? "").slice(0, 160)} · ${cop(p.precio_base)} · ${p.modalidad ?? ""} · ${p.ciudad ?? ""}`;
      },
    },
    {
      tipo: "cambio",
      etiqueta: "Cambio",
      titulo: "Cambios en procesos",
      emoji: "🔄",
      linea: (e) => {
        const campo = e.campo ?? "";
        return `${ETIQUETAS_CAMPO[campo] ?? campo}: ${valorLegible(campo, e.valor_antes)} → ${valorLegible(campo, e.valor_ahora)}`;
      },
    },
    { tipo: "documento", etiqueta: "Documento", titulo: "Documentos nuevos (adendas, respuestas, informes)", emoji: "📎", linea: (e) => e.valor_ahora ?? "" },
  ];

  for (const g of grupos) {
    const del = eventos.filter((e) => e.tipo === g.tipo);
    if (!del.length) continue;
    tg.push("", `${g.emoji} <b>${g.titulo} (${del.length})</b>`);
    html.push(`<h3>${g.titulo} (${del.length})</h3><ul>`);
    txt.push("", `${g.titulo.toUpperCase()} (${del.length})`);
    for (const e of del) {
      const linea = g.linea(e);
      tg.push(`• <a href="${enlace(e)}">${escapar(titulo(e))}</a>: ${escapar(linea)}`);
      html.push(`<li><a href="${enlace(e)}"><b>${escapar(titulo(e))}</b></a>: ${escapar(linea)}</li>`);
      txt.push(`- ${titulo(e)}: ${linea} ${enlace(e)}`);
    }
    html.push("</ul>");
  }

  tg.push("", `<a href="${PANEL_URL}">Abrir el panel</a>`);
  html.push(`<p><a href="${PANEL_URL}">Abrir el panel de licitaciones</a></p>`);
  txt.push("", `Panel: ${PANEL_URL}`);

  // Asunto con prefijo fijo y el tipo de cada novedad, para filtrar en el correo.
  const asuntoPartes = grupos
    .map((g) => [g, eventos.filter((e) => e.tipo === g.tipo).length] as const)
    .filter(([, n]) => n > 0)
    .map(([g, n]) => `${g.etiqueta} (${n})`);
  return {
    asunto: `[SECOP] ${asuntoPartes.join(" · ")}`,
    html: `<div style="font-family:Arial,sans-serif;font-size:14px;color:#111827">${html.join("\n")}</div>`,
    telegram: tg.join("\n"),
    texto: txt.join("\n"),
  };
}

interface Resumen {
  leidos: number;
  nuevos: number;
  cambios: number;
  documentos: number;
  descargas: number;
  primeraCarga: boolean;
  socrataSinCambios: boolean;
  fuenteActualizada: number | null;
  retirados: number;
}

// Pasos 1 a 3: Socrata → secop_procesos, secop_eventos y secop_documentos.
async function leerSocrata(
  db: SupabaseClient,
  r: Resumen,
  eventos: Array<Record<string, unknown>>,
  desde: string,
  marca: string,
) {
  // 1. Procesos de la ventana + los que el equipo sigue fuera de ella.
  const hoy = new Date(Date.now() - 5 * 3600e3).toISOString().slice(0, 10); // fecha en Colombia
  const crudos = await consultar<ProcesoSocrata>(DATASET_PROCESOS, {
    select: SELECT_PROCESOS,
    where: whereDescubrimiento(desde, hoy),
  });
  // Los que el equipo sigue se piden por id: así llegan su cierre, adjudicación y ganador aunque
  // ya no salgan en la búsqueda de abiertos.
  const { data: seguidos } = await db.from("secop_procesos").select("id_proceso").in("seguimiento", SEGUIMIENTO_ACTIVO);
  const idsSeguidos = new Set((seguidos ?? []).map((s) => s.id_proceso as string));
  for (const lote of trozos([...idsSeguidos], 100)) {
    crudos.push(
      ...(await consultar<ProcesoSocrata>(DATASET_PROCESOS, {
        select: SELECT_PROCESOS,
        where: `id_del_proceso in (${listaIds(lote)})`,
      })),
    );
  }
  // Socrata repite filas de un mismo proceso: se queda la última por id.
  const porId = new Map<string, Fila>();
  for (const p of crudos) if (p.id_del_proceso) porId.set(p.id_del_proceso, aFila(p));
  r.leidos = porId.size;
  // Solo se guardan los aptos y los que el equipo sigue (aunque dejen de ser aptos): lo demás es ruido.
  const filas = [...porId.values()].filter((f) => f.apto || idsSeguidos.has(f.id_proceso));
  const abiertos = new Set(filas.map((f) => f.id_proceso));

  // 2. Comparar contra lo guardado.
  const { count } = await db.from("secop_procesos").select("id_proceso", { count: "exact", head: true });
  r.primeraCarga = (count ?? 0) === 0;
  const guardados = new Map<string, Fila & { seguimiento: string; ficha_cerrada: boolean }>();
  for (const lote of trozos(filas.map((f) => f.id_proceso), 200)) {
    const { data, error } = await db.from("secop_procesos").select("*").in("id_proceso", lote);
    if (error) throw error;
    for (const g of data ?? []) guardados.set(g.id_proceso, g);
  }

  // Procesos que ya se avisaron alguna vez (aunque luego se hayan borrado al cerrarse).
  const yaAvisados = new Set<string>();
  const sinGuardar = filas.map((f) => f.id_proceso).filter((id) => !guardados.has(id));
  for (const lote of trozos(sinGuardar, 200)) {
    const { data } = await db.from("secop_avisados").select("id_proceso").in("id_proceso", lote);
    for (const a of data ?? []) yaAvisados.add(a.id_proceso);
  }

  const porEscribir: Array<Fila & { ultima_sincronizacion: string }> = [];
  for (const f of filas) {
    const antes = guardados.get(f.id_proceso);
    if (!antes) {
      porEscribir.push({ ...f, ultima_sincronizacion: marca });
      // Un proceso se avisa como nuevo una sola vez en la vida.
      if (f.apto && !yaAvisados.has(f.id_proceso)) {
        r.nuevos++;
        // En la primera carga no se avisa proceso por proceso.
        eventos.push({ id_proceso: f.id_proceso, tipo: "nuevo", notificado: r.primeraCarga, leido: r.primeraCarga });
      }
      continue;
    }
    if (!filaCambio(antes, f)) continue;
    porEscribir.push({ ...f, ultima_sincronizacion: marca });
    // Los cambios solo se avisan en los procesos que el equipo sigue: de lo demás solo importa que es nuevo.
    if (!SEGUIMIENTO_ACTIVO.includes(antes.seguimiento)) continue;
    for (const c of diferencias(antes, f)) {
      r.cambios++;
      eventos.push({ id_proceso: f.id_proceso, tipo: "cambio", campo: c.campo, valor_antes: c.antes, valor_ahora: c.ahora });
    }
  }
  for (const lote of trozos(porEscribir, 500)) {
    const { error } = await db.from("secop_procesos").upsert(lote, { onConflict: "id_proceso" });
    if (error) throw error;
  }

  // Limpieza: lo que ya no está abierto y el equipo no sigue (nuevo o descartado) sale del panel.
  // Si Socrata no devolvió nada (falla o recarga a medias) no se borra nada.
  if (abiertos.size > 0) {
    // Paginado: Supabase devuelve como máximo 1000 filas por consulta.
    const candidatos: string[] = [];
    for (let desdeFila = 0; ; desdeFila += 1000) {
      const { data, error } = await db
        .from("secop_procesos")
        .select("id_proceso")
        .in("seguimiento", ["nuevo", "descartado"])
        .order("id_proceso")
        .range(desdeFila, desdeFila + 999);
      if (error) throw error;
      candidatos.push(...(data ?? []).map((c) => c.id_proceso as string));
      if ((data ?? []).length < 1000) break;
    }
    const cerrados = candidatos.filter((id) => !abiertos.has(id));
    for (const lote of trozos(cerrados, 200)) {
      const { error } = await db.from("secop_procesos").delete().in("id_proceso", lote);
      if (error) throw error;
    }
    r.retirados = cerrados.length;
  }

  // 3. Documentos de los procesos aptos recientes o en seguimiento.
  const { data: conDocs } = await db
    .from("secop_procesos")
    .select("id_proceso, id_portafolio, seguimiento, ficha_cerrada")
    .eq("apto", true)
    .neq("seguimiento", "descartado")
    .not("id_portafolio", "is", null)
    .or(`seguimiento.in.(${SEGUIMIENTO_ACTIVO.join(",")}),fecha_publicacion.gte.${desde}`);
  const procesoDePortafolio = new Map(
    (conDocs ?? [])
      .filter((p) => !(p.ficha_cerrada && p.seguimiento === "nuevo"))
      .map((p) => [p.id_portafolio as string, p.id_proceso as string]),
  );
  const seguidosConDocs = new Set(
    (conDocs ?? []).filter((p) => SEGUIMIENTO_ACTIVO.includes(p.seguimiento)).map((p) => p.id_proceso as string),
  );
  const docsRemotos: Array<Record<string, any>> = [];
  for (const lote of trozos([...procesoDePortafolio.keys()], 80)) {
    docsRemotos.push(
      ...(await consultar<Record<string, any>>(DATASET_DOCUMENTOS, {
        select: "id_documento,proceso,nombre_archivo,extensi_n,tamanno_archivo,fecha_carga,url_descarga_documento",
        where: `proceso in (${listaIds(lote)})`,
      })),
    );
  }
  const guardadosDocs = new Map<string, { origen: string }>();
  for (const lote of trozos(docsRemotos.map((d) => d.id_documento as string), 300)) {
    const { data } = await db.from("secop_documentos").select("id_documento, origen").in("id_documento", lote);
    for (const d of data ?? []) guardadosDocs.set(d.id_documento, d);
  }
  const aFilaDoc = (d: Record<string, any>) => ({
    id_documento: d.id_documento as string,
    id_proceso: procesoDePortafolio.get(d.proceso)!,
    nombre: d.nombre_archivo as string,
    extension: d.extensi_n ?? null,
    tamano: d.tamanno_archivo ? Number(d.tamanno_archivo) : null,
    fecha_carga: d.fecha_carga ?? null,
    url_origen: d.url_descarga_documento?.url ?? null,
  });
  const docsNuevos = docsRemotos.filter((d) => !guardadosDocs.has(d.id_documento)).map(aFilaDoc);
  for (const lote of trozos(docsNuevos, 500)) {
    const { error } = await db.from("secop_documentos").insert(lote);
    if (error) throw error;
  }
  // Los que el panel capturó de la ficha antes que Socrata se completan con extensión, tamaño y fecha.
  const docsCompletar = docsRemotos.filter((d) => guardadosDocs.get(d.id_documento)?.origen === "portal").map(aFilaDoc);
  for (const d of docsCompletar) {
    await db
      .from("secop_documentos")
      .update({ extension: d.extension, tamano: d.tamano, fecha_carga: d.fecha_carga, origen: "socrata" })
      .eq("id_documento", d.id_documento);
  }
  r.documentos = docsNuevos.length;
  // Un documento nuevo en un proceso que seguimos suele ser una adenda o una respuesta.
  for (const d of docsNuevos) {
    if (seguidosConDocs.has(d.id_proceso) && !r.primeraCarga) {
      eventos.push({ id_proceso: d.id_proceso, tipo: "documento", valor_ahora: d.nombre });
    }
  }
}

// Paso 4: recordatorios de cierre e hitos del cronograma en las próximas 48 horas.
async function recordatorios(db: SupabaseClient, eventos: Array<Record<string, unknown>>, ahora: Date) {
  const marca = ahora.toISOString();
  const en48h = new Date(ahora.getTime() + 48 * 3600e3).toISOString();
  const hace2d = new Date(ahora.getTime() - 48 * 3600e3).toISOString();

  const [{ data: ofertar }, { data: hitos }, { data: yaAvisados }] = await Promise.all([
    db.from("secop_procesos").select("id_proceso, fecha_cierre, fecha_recepcion_ofertas").eq("seguimiento", "ofertar"),
    db
      .from("secop_cronograma")
      .select("id_proceso, etiqueta, fecha, secop_procesos!inner(seguimiento)")
      .in("secop_procesos.seguimiento", SEGUIMIENTO_ACTIVO)
      .gte("fecha", marca)
      .lte("fecha", en48h),
    db
      .from("secop_eventos")
      .select("id_proceso, tipo, campo, valor_ahora")
      .in("tipo", ["recordatorio_cierre", "hito"])
      .gte("creado", hace2d),
  ]);
  const clave = (id: string, tipo: string, campo: string | null, valor: string) => `${id}|${tipo}|${campo ?? ""}|${valor}`;
  const avisado = new Set((yaAvisados ?? []).map((e) => clave(e.id_proceso, e.tipo, e.campo, e.valor_ahora ?? "")));

  for (const p of ofertar ?? []) {
    // Sin cronograma capturado se usa la fecha de Socrata, que solo trae el día: se toma el final del día.
    const cierre = p.fecha_cierre ?? (p.fecha_recepcion_ofertas
      ? new Date(new Date(p.fecha_recepcion_ofertas).getTime() + 864e5 - 60e3).toISOString()
      : null);
    if (!cierre || cierre < marca || cierre > en48h) continue;
    const valor = horaColombia(cierre);
    if (avisado.has(clave(p.id_proceso, "recordatorio_cierre", null, valor))) continue;
    eventos.push({ id_proceso: p.id_proceso, tipo: "recordatorio_cierre", valor_ahora: valor });
  }
  for (const h of hitos ?? []) {
    const valor = horaColombia(h.fecha);
    if (avisado.has(clave(h.id_proceso, "hito", h.etiqueta, valor))) continue;
    eventos.push({ id_proceso: h.id_proceso, tipo: "hito", campo: h.etiqueta, valor_ahora: valor });
  }
}

// Paso 5: descarga pocos documentos por corrida para no activar el bloqueo de SECOP.
async function descargar(db: SupabaseClient, limite: number, idProceso?: string): Promise<number> {
  let q = db
    .from("secop_documentos")
    .select("id_documento, id_proceso, nombre, tamano, url_origen, secop_procesos!inner(seguimiento, apto, ficha_cerrada)")
    .is("storage_path", null)
    .is("error_descarga", null)
    .order("creado", { ascending: true })
    .limit(idProceso ? limite : limite * 5);
  q = idProceso
    ? q.eq("id_proceso", idProceso)
    : q.eq("secop_procesos.apto", true).neq("secop_procesos.seguimiento", "descartado");
  const { data: candidatos } = await q;
  // Lo que la ficha mostró cerrado y nadie sigue no gasta descargas.
  const pendientes = (candidatos ?? [])
    .filter((d) => {
      const p = d.secop_procesos as unknown as { seguimiento: string; ficha_cerrada: boolean };
      return idProceso || !(p.ficha_cerrada && p.seguimiento === "nuevo");
    })
    .slice(0, limite);

  let descargas = 0;
  for (const d of pendientes) {
    let error: string | null = null;
    let path: string | null = null;
    try {
      if (!d.url_origen) throw new Error("Sin enlace de descarga");
      if (d.tamano && d.tamano > MAX_MB * 1024 * 1024) throw new Error(`Pesa más de ${MAX_MB} MB: descargar desde SECOP`);
      const r = await fetch(d.url_origen, {
        headers: { "User-Agent": UA_NAVEGADOR, Accept: "application/pdf,application/octet-stream,*/*" },
        signal: AbortSignal.timeout(90_000),
      });
      if (!r.ok) throw new Error(`SECOP respondió ${r.status}`);
      const tipo = r.headers.get("content-type") ?? "application/octet-stream";
      // Si SECOP devuelve su página de captcha en vez del archivo, es el mismo bloqueo temporal que un 403.
      if (tipo.includes("text/html")) throw new Error("SECOP respondió 403 (página HTML en vez del archivo)");
      const nombreSeguro = d.nombre.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9._-]+/g, "_");
      path = `${d.id_proceso}/${d.id_documento}-${nombreSeguro}`;
      const { error: subida } = await db.storage
        .from("secop-documentos")
        .upload(path, await r.arrayBuffer(), { contentType: tipo, upsert: true });
      if (subida) throw subida;
      descargas++;
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
  return descargas;
}

async function sincronizar(db: SupabaseClient, origen: Origen): Promise<Resumen & { erroresAviso: string[]; socrataToken: string }> {
  const r: Resumen = {
    leidos: 0,
    nuevos: 0,
    cambios: 0,
    documentos: 0,
    descargas: 0,
    primeraCarga: false,
    socrataSinCambios: false,
    fuenteActualizada: null,
    retirados: 0,
  };
  const ahora = new Date();
  const desde = new Date(ahora.getTime() - VENTANA_DIAS * 864e5).toISOString().slice(0, 10);
  const eventos: Array<Record<string, unknown>> = [];

  // Si Socrata no se ha recargado desde la última corrida completa, el cron no la repite.
  // Desde el panel ("Sincronizar ahora") siempre se lee.
  r.fuenteActualizada = await ultimaRecarga(DATASET_PROCESOS);
  const { data: anterior } = await db
    .from("secop_sync_runs")
    .select("fuente_actualizada")
    .eq("ok", true)
    .not("fuente_actualizada", "is", null)
    .order("inicio", { ascending: false })
    .limit(1)
    .maybeSingle();
  r.socrataSinCambios =
    origen === "cron" && r.fuenteActualizada !== null && anterior?.fuente_actualizada === r.fuenteActualizada;

  if (!r.socrataSinCambios) await leerSocrata(db, r, eventos, desde, ahora.toISOString());
  await recordatorios(db, eventos, ahora);

  for (const lote of trozos(eventos, 500)) {
    // Los eventos traen columnas distintas según el tipo: las que falten toman su valor por defecto.
    const { error } = await db.from("secop_eventos").insert(lote, { defaultToNull: false });
    if (error) throw error;
  }
  const avisadosAhora = eventos.filter((e) => e.tipo === "nuevo").map((e) => ({ id_proceso: e.id_proceso as string }));
  for (const lote of trozos(avisadosAhora, 500)) {
    const { error } = await db.from("secop_avisados").upsert(lote, { onConflict: "id_proceso", ignoreDuplicates: true });
    if (error) throw error;
  }

  r.descargas = await descargar(db, MAX_DESCARGAS);

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
  } else if (r.primeraCarga) {
    erroresAviso = await notificar({
      asunto: "SECOP: monitor activado",
      telegram: `<b>SECOP · Soy Proceso</b>\nMonitor activado: ${r.nuevos} procesos aptos cargados de los últimos ${VENTANA_DIAS} días.\n<a href="${PANEL_URL}">Ver en el panel</a>`,
      html: `<p>Monitor activado: ${r.nuevos} procesos aptos cargados de los últimos ${VENTANA_DIAS} días.</p><p><a href="${PANEL_URL}">Ver en el panel</a></p>`,
      texto: `Monitor activado: ${r.nuevos} procesos aptos cargados. ${PANEL_URL}`,
    });
  }
  return { ...r, erroresAviso, socrataToken: estadoToken.valor };
}

Deno.serve(async (req) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  };
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });
  const origen = await autorizado(req, db);
  if (!origen) return json({ error: "No autorizado" }, 401);

  const cuerpo = (await req.json().catch(() => ({}))) as { modo?: string; id_proceso?: string };

  // Descarga inmediata de los documentos pendientes de un proceso (botón del panel).
  if (cuerpo.modo === "descargas") {
    if (!cuerpo.id_proceso) return json({ error: "Falta id_proceso" }, 400);
    try {
      return json({ descargas: await descargar(db, 15, cuerpo.id_proceso) });
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : String(e) }, 500);
    }
  }

  const { data: corrida } = await db.from("secop_sync_runs").insert({ modo: origen }).select("id").single();
  try {
    const r = await sincronizar(db, origen);
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
        // Solo las corridas que leyeron Socrata sirven de referencia para la siguiente.
        fuente_actualizada: r.socrataSinCambios ? null : r.fuenteActualizada,
        error: r.erroresAviso.length ? r.erroresAviso.join(" | ") : null,
      })
      .eq("id", corrida?.id);
    return json(r);
  } catch (e) {
    const mensaje = e instanceof Error ? e.message : JSON.stringify(e);
    await db.from("secop_sync_runs").update({ fin: new Date().toISOString(), ok: false, error: mensaje }).eq("id", corrida?.id);
    return json({ error: mensaje }, 500);
  }
});
