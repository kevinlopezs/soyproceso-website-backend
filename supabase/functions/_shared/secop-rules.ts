// Reglas para decidir qué procesos de SECOP II le interesan a Soy Proceso.
// Funciones puras (sin Deno ni Node) para poder probarlas en cualquier runtime.

export type Categoria =
  | "bateria"
  | "intervencion"
  | "vigilancia"
  | "convivencia"
  | "pap"
  | "clima"
  | "capacitacion"
  | "otro";

export interface ProcesoSocrata {
  id_del_proceso: string;
  id_del_portafolio?: string;
  referencia_del_proceso?: string;
  entidad?: string;
  nit_entidad?: string;
  departamento_entidad?: string;
  ciudad_entidad?: string;
  nombre_del_procedimiento?: string;
  descripci_n_del_procedimiento?: string;
  modalidad_de_contratacion?: string;
  fase?: string;
  estado_del_procedimiento?: string;
  estado_resumen?: string;
  precio_base?: string;
  fecha_de_publicacion_del?: string;
  fecha_de_ultima_publicaci?: string;
  duracion?: string;
  unidad_de_duracion?: string;
  proveedores_que_manifestaron?: string;
  respuestas_al_procedimiento?: string;
  adjudicado?: string;
  nombre_del_proveedor?: string;
  valor_total_adjudicacion?: string;
  urlproceso?: { url?: string } | string;
  fecha_de_recepcion_de?: string;
  fecha_de_apertura_de_respuesta?: string;
  tipo_de_contrato?: string;
  codigo_principal_de_categoria?: string;
}

// Columnas que se piden a Socrata (28 de 52): menos datos por página y respuestas más rápidas.
export const SELECT_PROCESOS = [
  "id_del_proceso",
  "id_del_portafolio",
  "referencia_del_proceso",
  "entidad",
  "nit_entidad",
  "departamento_entidad",
  "ciudad_entidad",
  "nombre_del_procedimiento",
  "descripci_n_del_procedimiento",
  "modalidad_de_contratacion",
  "fase",
  "estado_del_procedimiento",
  "estado_resumen",
  "precio_base",
  "fecha_de_publicacion_del",
  "fecha_de_ultima_publicaci",
  "fecha_de_recepcion_de",
  "fecha_de_apertura_de_respuesta",
  "duracion",
  "unidad_de_duracion",
  "proveedores_que_manifestaron",
  "respuestas_al_procedimiento",
  "adjudicado",
  "nombre_del_proveedor",
  "valor_total_adjudicacion",
  "urlproceso",
  "tipo_de_contrato",
  "codigo_principal_de_categoria",
].join(",");

// Modalidades en las que Soy Proceso compite hoy: mínima cuantía (sin RUP, gana el menor precio
// entre las ofertas que cumplen), régimen especial (hospitales, universidades, empresas del
// Estado; caso a caso según el manual de cada entidad) y solicitudes de información, que son
// cotizaciones previas a un proceso: la señal más temprana para entrar.
export const MODALIDADES = ["Mínima cuantía", "Contratación régimen especial", "Solicitud de información a los Proveedores"];

// Estados de SECOP II en los que todavía se puede ofertar.
export const ESTADOS_ABIERTOS = ["Publicado", "Abierto", "Convocado"];

// Palabras clave en mayúsculas para el filtro SoQL (descripción o nombre). Cubren los
// servicios del portafolio: batería, intervención y vigilancia epidemiológica (PSICOSOCIAL),
// paquete Res. 3461 (comité de convivencia, acoso laboral, comunicación asertiva),
// primeros auxilios psicológicos y clima organizacional.
export const PALABRAS_CLAVE = [
  "PSICOSOCIAL",
  "CONVIVENCIA LABORAL",
  "COMITE DE CONVIVENCIA",
  "COMITÉ DE CONVIVENCIA",
  "ACOSO LABORAL",
  "COMUNICACION ASERTIVA",
  "COMUNICACIÓN ASERTIVA",
  "PRIMEROS AUXILIOS PSICOL",
  "CLIMA LABORAL",
  "CLIMA ORGANIZACIONAL",
];

// Códigos UNSPSC (código principal en SECOP) que más usan las entidades para estos servicios.
// Un proceso con uno de estos códigos entra aunque no diga "psicosocial", siempre que el objeto
// trate de riesgo laboral o bienestar de los trabajadores.
export const CODIGOS_UNSPSC = [
  "85121608", // Servicios médicos de doctores especialistas
  "80111500", // Desarrollo de recursos humanos
  "80111504",
  "93141808", // Servicios comunitarios y sociales: empleo
  "85122201", // Evaluación y valoración de salud individual
  "80101500", // Asesoría de gestión
  "80101511",
  "86132001", // Educación y capacitación en administración (Res. 3461)
];

// Palabras que debe tener el objeto de un proceso que entra solo por código UNSPSC.
const PALABRAS_TEMA_CODIGO = ["RIESGO", "BATER", "INTRALABORAL", "SALUD MENTAL", "BIENESTAR", "SEGURIDAD Y SALUD", "SST"];

const RE_TEMA_CODIGO = /RIESGO PSICOSOCIAL|FACTORES PSICOSOCIALES|BATER[ÍI]A|INTRALABORAL|SALUD MENTAL|BIENESTAR LABORAL|CONVIVENCIA|ACOSO LABORAL|CLIMA (LABORAL|ORGANIZACIONAL)/;

export const codigoUnspsc = (p: ProcesoSocrata) => p.codigo_principal_de_categoria?.replace(/^V\d+\./, "") ?? null;

const RE_PSICO =
  /PSICOSOCIAL|CONVIVENCIA LABORAL|COMIT[ÉE] DE CONVIVENCIA|ACOSO LABORAL|COMUNICACI[ÓO]N ASERTIVA|PRIMEROS AUXILIOS PSICOL|CLIMA (LABORAL|ORGANIZACIONAL)/;

// Tema de salud psicosocial en el trabajo (no atención psicosocial a comunidades).
const RE_TEMA_LABORAL =
  /RIESGO PSICOSOCIAL|FACTORES PSICOSOCIALES|BATER[ÍI]A|INTRALABORAL|CONVIVENCIA LABORAL|COMIT[ÉE] DE CONVIVENCIA|ACOSO LABORAL|COMUNICACI[ÓO]N ASERTIVA|CLIMA (LABORAL|ORGANIZACIONAL)|PRIMEROS AUXILIOS PSICOL/;

// Dirigido a trabajadores de la entidad.
const RE_TRABAJADORES =
  /SERVIDOR|FUNCIONARI|TRABAJADOR|COLABORADOR|EMPLEAD|CONTRATISTAS|PERSONAL (DE|VINCULADO|DE PLANTA)|SG.?SST|SEGURIDAD Y SALUD EN EL TRABAJO|TALENTO HUMANO|LABORAL/;

// Lo que Soy Proceso no puede ofrecer sola, con el motivo que se muestra en el panel.
const EXCLUSIONES: Array<[RegExp, string]> = [
  [/EX[ÁA]MEN(ES)? (M[ÉE]DIC|OCUPACIONAL)|EVALUACI[OÓ]N(ES)? M[ÉE]DICA|M[ÉE]DIC[OA]S? OCUPACIONAL|SERVICIOS M[ÉE]DICOS/, "Incluye exámenes médicos (requiere IPS)"],
  [/LOG[ÍI]STIC|OPERADOR LOG|TURISMO|RECREA|RECREODEPORT|ACONDICIONAMIENTO F[ÍI]SICO|JORNADA DE INTEGRACI|TRABAJO EN ALTURAS/, "Es logística, recreación u otra capacitación"],
  [/ADQUISICI[OÓ]N DE ELEMENTOS|ELEMENTOS DE|DOTACI[OÓ]N|SUMINISTRO DE (ELEMENTOS|INSUMOS)|OBSEQUIOS|MULTISENSORIAL|IMPRESI[OÓ]N/, "Es compra de bienes"],
  [/DISCAPACIDAD PSICOSOCIAL|ACOGIMIENTO|INTERNADO|PAPSIVI/, "Es atención social, no laboral"],
  [
    /TRABAJADOR INDEPENDIENTE|SERVICIOS PERSONALES|SERVICIOS (PROFESIONALES|ASISTENCIALES) (Y DE APOYO A LA GESTI[OÓ]N )?COMO|EN EL ROL DE|PROFESIONAL DE APOYO|EN SU CALIDAD DE|COMO PSIC[OÓ]LOG[OA]/,
    "Es contrato de una persona para un cargo, no un servicio de empresa",
  ],
  [/ESTUDIANTES|COMUNIDAD(ES)? EDUCATIVA|V[ÍI]CTIMAS|POBLACI[OÓ]N VULNERABLE|PRIMERA INFANCIA|ADULTOS? MAYOR|L[ÍI]DERES COMUNITARIOS/, "Dirigido a población, no a trabajadores"],
];

export function texto(p: ProcesoSocrata): string {
  return `${p.nombre_del_procedimiento ?? ""} ${p.descripci_n_del_procedimiento ?? ""}`.toUpperCase();
}

export function categoria(p: ProcesoSocrata): Categoria {
  const t = texto(p);
  if (/BATER[ÍI]A/.test(t) && /PSICOSOCIAL/.test(t)) return "bateria";
  if (/VIGILANCIA EPIDEMIOL/.test(t)) return "vigilancia";
  if (/PRIMEROS AUXILIOS PSICOL/.test(t)) return "pap";
  if (/CONVIVENCIA LABORAL|COMIT[ÉE] DE CONVIVENCIA/.test(t)) return "convivencia";
  if (/ACOSO LABORAL|COMUNICACI[ÓO]N ASERTIVA|RESOLUCI[ÓO]N 3461/.test(t)) return "capacitacion";
  if (/CAPACIT/.test(t) && /SALUD MENTAL|PSICOSOCIAL/.test(t)) return "capacitacion";
  if (/CLIMA (LABORAL|ORGANIZACIONAL)/.test(t)) return "clima";
  if (/PSICOSOCIAL/.test(t) && /INTERVENCI|PROGRAMA|GESTI[OÓ]N|PLAN DE/.test(t)) return "intervencion";
  return "otro";
}

export function evaluar(p: ProcesoSocrata): { apto: boolean; motivo: string | null } {
  const t = texto(p);
  const porCodigo = CODIGOS_UNSPSC.includes(codigoUnspsc(p) ?? "") && RE_TEMA_CODIGO.test(t);
  if (!RE_PSICO.test(t) && !porCodigo) return { apto: false, motivo: "No es un tema psicosocial" };
  if (p.modalidad_de_contratacion && !MODALIDADES.includes(p.modalidad_de_contratacion)) {
    return { apto: false, motivo: `Modalidad ${p.modalidad_de_contratacion}` };
  }
  for (const [re, motivo] of EXCLUSIONES) {
    if (re.test(t)) return { apto: false, motivo };
  }
  if (!(RE_TEMA_LABORAL.test(t) || porCodigo) || !RE_TRABAJADORES.test(t)) {
    return { apto: false, motivo: "Atención psicosocial a comunidad, no riesgo laboral" };
  }
  return { apto: true, motivo: null };
}

export function urlProceso(p: ProcesoSocrata): string | null {
  const u = typeof p.urlproceso === "string" ? p.urlproceso : p.urlproceso?.url;
  // Algunas filas traen la URL de login en vez de la del proceso: no sirve como enlace.
  if (!u || u.includes("/Login/")) return null;
  return u;
}

const num = (v?: string) => (v === undefined || v === "" ? null : Number(v));

// CO1.NTC.xxxx: identificador de la ficha pública en community.secop.gov.co.
export function noticeUid(url: string | null): string | null {
  return url?.match(/noticeUID=(CO1\.NTC\.\d+)/)?.[1] ?? null;
}

// Socrata entrega fechas sin zona; en SECOP II son hora de Colombia.
const fechaColombia = (v?: string) => (v ? `${v.slice(0, 19)}-05:00` : null);

const sinDefinir = (v?: string) => (v && !/^no defini/i.test(v) && v !== "UNSPECIFIED" ? v : null);

// Fila lista para la tabla secop_procesos (sin las columnas que maneja el equipo).
export function aFila(p: ProcesoSocrata) {
  const { apto, motivo } = evaluar(p);
  return {
    id_proceso: p.id_del_proceso,
    id_portafolio: p.id_del_portafolio ?? null,
    referencia: p.referencia_del_proceso ?? null,
    entidad: p.entidad ?? null,
    nit_entidad: p.nit_entidad ?? null,
    departamento: p.departamento_entidad ?? null,
    ciudad: p.ciudad_entidad ?? null,
    nombre: p.nombre_del_procedimiento ?? null,
    descripcion: p.descripci_n_del_procedimiento ?? null,
    modalidad: p.modalidad_de_contratacion ?? null,
    fase: p.fase ?? null,
    estado: p.estado_del_procedimiento ?? null,
    estado_resumen: p.estado_resumen ?? null,
    precio_base: num(p.precio_base),
    fecha_publicacion: p.fecha_de_publicacion_del ?? null,
    fecha_ultima_publicacion: p.fecha_de_ultima_publicaci ?? null,
    duracion: p.duracion ? `${p.duracion} ${p.unidad_de_duracion ?? ""}`.trim() : null,
    manifestaciones: num(p.proveedores_que_manifestaron),
    respuestas: num(p.respuestas_al_procedimiento),
    adjudicado: p.adjudicado === "Si",
    proveedor_adjudicado:
      p.nombre_del_proveedor && p.nombre_del_proveedor !== "No Definido" ? p.nombre_del_proveedor : null,
    valor_adjudicado: num(p.valor_total_adjudicacion),
    url: urlProceso(p),
    notice_uid: noticeUid(urlProceso(p)),
    fecha_recepcion_ofertas: fechaColombia(p.fecha_de_recepcion_de),
    fecha_apertura_ofertas: fechaColombia(p.fecha_de_apertura_de_respuesta),
    tipo_contrato: sinDefinir(p.tipo_de_contrato),
    codigo_unspsc: sinDefinir(p.codigo_principal_de_categoria),
    categoria: categoria(p),
    apto,
    motivo_no_apto: motivo,
  };
}

export type Fila = ReturnType<typeof aFila>;

// Campos cuyo cambio se registra como evento y se notifica.
export const CAMPOS_VIGILADOS: Array<keyof Fila> = [
  "fase",
  "estado",
  "estado_resumen",
  "precio_base",
  "fecha_ultima_publicacion",
  "fecha_recepcion_ofertas",
  "manifestaciones",
  "respuestas",
  "adjudicado",
  "proveedor_adjudicado",
  "valor_adjudicado",
];

// Supabase devuelve fechas con zona ("2026-09-30T00:00:00+00:00") y Socrata sin ella
// ("2026-09-30T00:00:00.000"); los números pueden venir como texto. Se comparan normalizados.
function normalizar(campo: string, v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (campo.startsWith("fecha")) {
    const s = String(v);
    const t = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}Z`);
    return Number.isNaN(t) ? s : String(t);
  }
  if (typeof v === "number" || (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v))) return String(Number(v));
  return String(v);
}

export function diferencias(antes: Partial<Fila>, ahora: Fila) {
  const cambios: Array<{ campo: string; antes: string | null; ahora: string | null }> = [];
  for (const campo of CAMPOS_VIGILADOS) {
    const a = antes[campo] ?? null;
    const b = ahora[campo] ?? null;
    if (normalizar(campo, a) !== normalizar(campo, b)) {
      cambios.push({ campo, antes: a === null ? null : String(a), ahora: b === null ? null : String(b) });
    }
  }
  return cambios;
}

// Filtro SoQL: temas psicosociales, modalidades donde se puede competir, publicados desde `desde`.
// Régimen especial no publica fecha de cierre en datos abiertos y muchas veces lo "publicado" es un
// contrato ya firmado. Sin fecha de cierre, un proceso solo cuenta como abierto estos días.
export const DIAS_ABIERTO_SIN_CIERRE = 15;

export function whereDescubrimiento(desde: string, hoy: string): string {
  const limiteSinCierre = new Date(Date.parse(`${hoy}T00:00:00Z`) - DIAS_ABIERTO_SIN_CIERRE * 864e5).toISOString().slice(0, 10);
  const temas = PALABRAS_CLAVE.map(
    (k) => `upper(descripci_n_del_procedimiento) like '%${k}%' OR upper(nombre_del_procedimiento) like '%${k}%'`,
  ).join(" OR ");
  const modalidades = MODALIDADES.map((m) => `'${m}'`).join(",");
  const codigos = CODIGOS_UNSPSC.map((c) => `'V1.${c}'`).join(",");
  const temaCodigo = PALABRAS_TEMA_CODIGO.map((k) => `upper(descripci_n_del_procedimiento) like '%${k}%'`).join(" OR ");
  const estados = ESTADOS_ABIERTOS.map((e) => `'${e}'`).join(",");
  // Solo abiertos: estado abierto, sin proveedor ya escogido (en régimen especial muchas entidades
  // publican como "Publicado" contratos directos que ya tienen contratista) y cierre de hoy en
  // adelante; sin cierre, publicado hace pocos días.
  return `fecha_de_publicacion_del >= '${desde}T00:00:00.000' AND modalidad_de_contratacion in (${modalidades}) AND estado_del_procedimiento in (${estados}) AND (codigoproveedor IS NULL OR codigoproveedor = 'No Definido') AND (fecha_de_recepcion_de >= '${hoy}T00:00:00.000' OR (fecha_de_recepcion_de IS NULL AND fecha_de_publicacion_del >= '${limiteSinCierre}T00:00:00.000')) AND ((${temas}) OR (codigo_principal_de_categoria in (${codigos}) AND (${temaCodigo})))`;
}

export const ETIQUETAS_CAMPO: Record<string, string> = {
  fase: "Fase",
  estado: "Estado",
  estado_resumen: "Estado resumen",
  precio_base: "Presupuesto",
  fecha_ultima_publicacion: "Última publicación",
  fecha_recepcion_ofertas: "Cierre de ofertas",
  manifestaciones: "Manifestaciones de interés",
  respuestas: "Ofertas recibidas",
  adjudicado: "Adjudicado",
  proveedor_adjudicado: "Ganador",
  valor_adjudicado: "Valor adjudicado",
};

// ¿Cambió alguna columna que escribe la sincronización? Solo esas filas se vuelven a guardar,
// en vez de reescribir cientos de procesos idénticos en cada corrida.
export function filaCambio(antes: Partial<Fila>, ahora: Fila): boolean {
  return (Object.keys(ahora) as Array<keyof Fila>).some(
    (campo) => normalizar(campo, antes[campo] ?? null) !== normalizar(campo, ahora[campo] ?? null),
  );
}
