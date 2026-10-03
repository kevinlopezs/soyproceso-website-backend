// Reglas para decidir qué procesos de SECOP II le interesan a Soy Proceso.
// Funciones puras (sin Deno ni Node) para poder probarlas en cualquier runtime.

export type Categoria =
  | "bateria"
  | "intervencion"
  | "vigilancia"
  | "convivencia"
  | "pap"
  | "clima"
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
}

// Modalidades en las que una persona natural puede competir.
export const MODALIDADES = [
  "Mínima cuantía",
  "Contratación régimen especial",
  "Selección Abreviada de Menor Cuantía",
  "Solicitud de información a los Proveedores",
];

// Palabras clave en mayúsculas para el filtro SoQL (descripción o nombre).
export const PALABRAS_CLAVE = [
  "PSICOSOCIAL",
  "CONVIVENCIA LABORAL",
  "PRIMEROS AUXILIOS PSICOL",
  "CLIMA LABORAL",
  "CLIMA ORGANIZACIONAL",
];

const RE_PSICO = /PSICOSOCIAL|CONVIVENCIA LABORAL|PRIMEROS AUXILIOS PSICOL|CLIMA (LABORAL|ORGANIZACIONAL)/;

// Tema de salud psicosocial en el trabajo (no atención psicosocial a comunidades).
const RE_TEMA_LABORAL =
  /RIESGO PSICOSOCIAL|FACTORES PSICOSOCIALES|BATER[ÍI]A|INTRALABORAL|CONVIVENCIA LABORAL|CLIMA (LABORAL|ORGANIZACIONAL)|PRIMEROS AUXILIOS PSICOL/;

// Dirigido a trabajadores de la entidad.
const RE_TRABAJADORES =
  /SERVIDOR|FUNCIONARI|TRABAJADOR|COLABORADOR|EMPLEAD|CONTRATISTAS|PERSONAL (DE|VINCULADO|DE PLANTA)|SG.?SST|SEGURIDAD Y SALUD EN EL TRABAJO|TALENTO HUMANO|LABORAL/;

// Lo que Soy Proceso no puede ofrecer sola, con el motivo que se muestra en el panel.
const EXCLUSIONES: Array<[RegExp, string]> = [
  [/EX[ÁA]MEN(ES)? (M[ÉE]DIC|OCUPACIONAL)|EVALUACI[OÓ]N(ES)? M[ÉE]DICA|M[ÉE]DIC[OA]S? OCUPACIONAL|SERVICIOS M[ÉE]DICOS/, "Incluye exámenes médicos (requiere IPS)"],
  [/LOG[ÍI]STIC|OPERADOR LOG|TURISMO|RECREA|RECREODEPORT|ACONDICIONAMIENTO F[ÍI]SICO|JORNADA DE INTEGRACI|TRABAJO EN ALTURAS/, "Es logística, recreación u otra capacitación"],
  [/ADQUISICI[OÓ]N DE ELEMENTOS|ELEMENTOS DE|DOTACI[OÓ]N|SUMINISTRO DE (ELEMENTOS|INSUMOS)|OBSEQUIOS|MULTISENSORIAL|IMPRESI[OÓ]N/, "Es compra de bienes"],
  [/DISCAPACIDAD PSICOSOCIAL|ACOGIMIENTO|INTERNADO|PAPSIVI/, "Es atención social, no laboral"],
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
  if (/CONVIVENCIA LABORAL/.test(t)) return "convivencia";
  if (/CLIMA (LABORAL|ORGANIZACIONAL)/.test(t)) return "clima";
  if (/PSICOSOCIAL/.test(t) && /INTERVENCI|PROGRAMA|GESTI[OÓ]N|PLAN DE/.test(t)) return "intervencion";
  return "otro";
}

export function evaluar(p: ProcesoSocrata): { apto: boolean; motivo: string | null } {
  const t = texto(p);
  if (!RE_PSICO.test(t)) return { apto: false, motivo: "No es un tema psicosocial" };
  if (p.modalidad_de_contratacion && !MODALIDADES.includes(p.modalidad_de_contratacion)) {
    return { apto: false, motivo: `Modalidad ${p.modalidad_de_contratacion}` };
  }
  for (const [re, motivo] of EXCLUSIONES) {
    if (re.test(t)) return { apto: false, motivo };
  }
  if (!RE_TEMA_LABORAL.test(t) || !RE_TRABAJADORES.test(t)) {
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
export function whereDescubrimiento(desde: string): string {
  const temas = PALABRAS_CLAVE.map(
    (k) => `upper(descripci_n_del_procedimiento) like '%${k}%' OR upper(nombre_del_procedimiento) like '%${k}%'`,
  ).join(" OR ");
  const modalidades = MODALIDADES.map((m) => `'${m}'`).join(",");
  return `fecha_de_publicacion_del >= '${desde}' AND modalidad_de_contratacion in (${modalidades}) AND (${temas})`;
}

export const ETIQUETAS_CAMPO: Record<string, string> = {
  fase: "Fase",
  estado: "Estado",
  estado_resumen: "Estado resumen",
  precio_base: "Presupuesto",
  fecha_ultima_publicacion: "Última publicación",
  manifestaciones: "Manifestaciones de interés",
  respuestas: "Ofertas recibidas",
  adjudicado: "Adjudicado",
  proveedor_adjudicado: "Ganador",
  valor_adjudicado: "Valor adjudicado",
};
