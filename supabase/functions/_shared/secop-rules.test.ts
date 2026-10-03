// Pruebas de las reglas del monitor. Correr con:
//   node --experimental-strip-types --test supabase/functions/_shared/secop-rules.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { aFila, diferencias, evaluar, type ProcesoSocrata } from "./secop-rules.ts";

const base: ProcesoSocrata = {
  id_del_proceso: "CO1.REQ.1",
  modalidad_de_contratacion: "Mínima cuantía",
  fase: "Presentación de oferta",
  precio_base: "9300000",
  fecha_de_ultima_publicaci: "2026-09-30T00:00:00.000",
  respuestas_al_procedimiento: "0",
  adjudicado: "No",
};
const con = (descripcion: string, extra: Partial<ProcesoSocrata> = {}): ProcesoSocrata => ({
  ...base,
  descripci_n_del_procedimiento: descripcion,
  ...extra,
});

test("batería para servidores públicos es apta", () => {
  const p = con("Aplicar, evaluar y diagnosticar la Batería de Instrumentos para la evaluación de los Factores de Riesgo Psicosocial a los servidores públicos del Instituto Nacional de Salud.");
  assert.deepEqual(evaluar(p), { apto: true, motivo: null });
  assert.equal(aFila(p).categoria, "bateria");
});

test("batería con exámenes médicos no es apta", () => {
  const p = con("Exámenes médicos ocupacionales de ingreso, periódicos y aplicación de la batería de riesgo psicosocial para los funcionarios");
  assert.equal(evaluar(p).apto, false);
});

test("atención psicosocial a víctimas no es apta", () => {
  const p = con("Atención psicosocial individual y familiar a la población víctima del conflicto armado", {
    modalidad_de_contratacion: "Contratación régimen especial",
  });
  assert.equal(evaluar(p).apto, false);
});

test("apoyo psicosocial escolar no es apto", () => {
  const p = con("Profesional de apoyo psicosocial para el fortalecimiento del sistema de convivencia escolar de la institución educativa");
  assert.equal(evaluar(p).apto, false);
});

test("contratación directa no es apta", () => {
  const p = con("Aplicación de la batería de riesgo psicosocial a los funcionarios", { modalidad_de_contratacion: "Contratación directa" });
  assert.equal(evaluar(p).apto, false);
});

test("clima laboral con talleres es apto; logística no", () => {
  assert.equal(evaluar(con("Diez talleres de formación lúdica dirigidos a los colaboradores para mejorar el clima laboral")).apto, true);
  assert.equal(evaluar(con("Apoyo logístico para jornadas de intervención al clima laboral de los funcionarios")).apto, false);
});

test("las fechas en otro formato no cuentan como cambio", () => {
  const ahora = aFila(con("Batería de riesgo psicosocial para servidores"));
  const guardado = { ...ahora, fecha_ultima_publicacion: "2026-09-30T00:00:00+00:00", precio_base: "9300000" as unknown as number };
  assert.deepEqual(diferencias(guardado, ahora), []);
});

test("detecta cambio de fase y de ofertas", () => {
  const antes = aFila(con("Batería de riesgo psicosocial para servidores"));
  const ahora = aFila(con("Batería de riesgo psicosocial para servidores", { fase: "Evaluación", respuestas_al_procedimiento: "4" }));
  assert.deepEqual(
    diferencias(antes, ahora).map((c) => c.campo),
    ["fase", "respuestas"],
  );
});

test("la URL de login no se guarda como enlace", () => {
  const p = con("Batería de riesgo psicosocial para servidores", {
    urlproceso: { url: "https://community.secop.gov.co/STS/Users/Login/Index" },
  });
  assert.equal(aFila(p).url, null);
});
