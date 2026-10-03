# Plan: monitor de licitaciones SECOP en el backend de Soy Proceso

Documento de plan. Nada de esto está desplegado todavía.

## 1. Objetivo

Que el equipo se entere cada día, sin entrar a SECOP, de:

- Procesos nuevos de batería, riesgo psicosocial, convivencia laboral, primeros auxilios psicológicos y clima organizacional en los que Soy Proceso pueda participar.
- Cambios en los procesos que estamos siguiendo: fase, estado, número de ofertas, adjudicación y ganador.
- Documentos nuevos en esos procesos (adendas, respuestas a observaciones, informes de evaluación).
- Cierres que se acercan en los procesos que decidimos ofertar.

Los avisos llegan por **correo (Amazon SES)** y **Telegram**, y todo queda en el **panel de admin**, con los documentos guardados.

## 2. Lo que confirmamos de la API (Socrata, datos.gov.co)

| Pregunta | Respuesta |
|---|---|
| ¿Hay procesos con su estado? | Sí: dataset `p6dx-8zbt` (SECOP II, procesos). Trae fase, estado, ofertas recibidas, adjudicación, ganador y valor. |
| ¿Cada cuánto se actualiza? | Una vez al día. El dataset se recarga completo entre las 12:00 y las 15:30 (hora Colombia). |
| ¿Se pueden detectar cambios con la API? | No directamente: el campo `:updated_at` es el mismo para todas las filas porque se recarga todo. **Los cambios se detectan comparando contra nuestra copia en Supabase.** |
| ¿Hay documentos? | Sí: dataset `dmgg-8hin` (SECOP II, archivos desde 2025). Se enlaza por `id_del_portafolio` (CO1.BDOS…). Probado con el proceso del INS: aparecen sus 8 documentos. |
| ¿Se pueden descargar? | Sí, enviando un User-Agent de navegador. Sin él, SECOP responde 403. Con muchas descargas seguidas también bloquea por un rato: hay que descargar pocos por corrida, con pausas. |
| ¿Trae la fecha de cierre? | No. La fecha de cierre se copia a mano en el panel cuando decidimos ofertar. |
| Límite de uso | Con el token de aplicación de Socrata no hay problema para este volumen. |

**Consecuencia:** el aviso llega con hasta un día de retraso frente a SECOP. Sirve para descubrir procesos y seguir cambios. Los plazos de horas (observaciones, cierre) se vigilan en SECOP directamente.

## 3. Qué filtra el monitor

Prueba con los últimos 60 días: de 1.721 procesos que mencionan estos temas, **98 son aptos**. El resto es atención psicosocial a comunidades, víctimas o estudiantes, contratos con exámenes médicos o logística de eventos.

Reglas:

1. **Modalidades** en las que se puede competir: mínima cuantía, régimen especial, selección abreviada de menor cuantía y solicitudes de información (RFI, la señal temprana de un proceso futuro).
2. El tema tiene que ser **laboral** (riesgo psicosocial, batería, convivencia laboral, clima, primeros auxilios psicológicos) y estar **dirigido a trabajadores o servidores**.
3. Se excluye lo que Soy Proceso no puede ofrecer sola: exámenes médicos (requieren IPS), logística o recreación, compra de bienes y programas sociales.

Cada proceso queda con una **categoría** (batería, intervención, vigilancia epidemiológica, convivencia, primeros auxilios psicológicos, clima) y, si no es apto, con el **motivo**.

## 4. Arquitectura en Supabase

```
pg_cron (7:00 y 16:30, hora Colombia)
   └─> Edge Function secop-sync
         ├─ Socrata: procesos (ventana de 45 días + los que seguimos)
         ├─ Compara contra secop_procesos → crea eventos (nuevo / cambio)
         ├─ Socrata: documentos de los procesos aptos → secop_documentos
         ├─ Descarga documentos pendientes → Storage "secop-documentos"
         ├─ Recordatorios de cierre (procesos marcados "ofertar")
         └─ Aviso único → Telegram + correo SES
Panel admin (Next.js) ── lee tablas, cambia seguimiento, abre documentos
```

### Tablas

| Tabla | Para qué |
|---|---|
| `secop_procesos` | Copia de cada proceso, con su categoría, si es apto y el motivo. Columnas del equipo: `seguimiento` (nuevo, revisando, ofertar, ofertado, descartado, ganado, perdido), `fecha_cierre` y `notas`. |
| `secop_eventos` | Historial: proceso nuevo, cambio de campo (antes → ahora), documento nuevo, recordatorio de cierre. Marca si ya se avisó. |
| `secop_documentos` | Documentos de cada proceso: nombre, fecha, enlace de origen y ruta en Storage. |
| `secop_sync_runs` | Registro de cada corrida: cuántos procesos leyó, nuevos, cambios, documentos y errores. |

Seguridad: RLS activado. El equipo (usuarios autenticados) lee todo y solo puede editar el seguimiento, la fecha de cierre y las notas. La sincronización escribe con la service role. El bucket de documentos es privado.

### Avisos

- **Un solo mensaje por corrida**, agrupado en: cierres próximos, procesos nuevos aptos, cambios y documentos nuevos. Si no hay nada, no se envía nada.
- **Telegram:** un bot creado con @BotFather, que publica en un grupo del equipo.
- **Correo:** Amazon SES, desde una dirección del dominio, por ejemplo `alertas@soyproceso.com`.
- **Primera corrida:** carga los últimos 45 días sin avisar proceso por proceso y envía un solo mensaje: "monitor activado, N procesos cargados".

### Panel de admin: nueva vista "Licitaciones SECOP"

- Pestañas: abiertos, en seguimiento, todos los aptos, no aptos.
- Cada proceso muestra entidad, objeto, presupuesto, modalidad, ciudad, fase y ofertas recibidas, con un enlace a SECOP.
- Selector de seguimiento, fecha de cierre y notas.
- Documentos descargados (enlace firmado) o enlace a SECOP si aún no se han bajado.
- Línea de tiempo de cambios del proceso.
- Botón "Sincronizar ahora" y la hora de la última corrida.

## 5. Lo que se necesita de ustedes

| Dato | Dónde se configura |
|---|---|
| Token de aplicación de Socrata (ya lo tienen; conviene regenerarlo porque quedó escrito en el chat) | Secretos de Edge Functions en Supabase |
| Bot de Telegram: token y chat ID del grupo | Secretos de Edge Functions |
| Clave de AWS con permiso **solo** para SES (`ses:SendEmail`), región y remitente verificado | Secretos de Edge Functions |
| Correos que reciben los avisos | Secretos de Edge Functions |
| Activar `pg_cron` y `pg_net` en el proyecto | Supabase → Integrations |
| Acceso para desplegar (Supabase CLI o el dashboard) | Ustedes, o me dan acceso |

## 6. Fases

| Fase | Qué incluye | Resultado |
|---|---|---|
| **1. Base de datos** | Tablas, RLS y bucket (una migración SQL) | Estructura lista |
| **2. Sincronización** | Edge Function `secop-sync`, probada contra la API real | Procesos y cambios guardados |
| **3. Avisos** | Telegram + SES y la programación con pg_cron | Aviso diario funcionando |
| **4. Panel** | Vista "Licitaciones SECOP" en el admin | El equipo trabaja los procesos desde el panel |
| **5. Ajuste** | Revisar 2 semanas de avisos y afinar palabras clave y exclusiones | Menos ruido |

Cada fase se puede revisar y aprobar antes de pasar a la siguiente.

## 7. Riesgos

- **Retraso de un día** por la recarga diaria de Socrata. Mitigación: los plazos cortos se revisan en SECOP.
- **Bloqueo de descargas** por parte de SECOP. Mitigación: pocas descargas por corrida, pausas y reintentos en la siguiente.
- **Ruido en los filtros.** Mitigación: estado "descartado" en el panel y fase 5 de ajuste.
- **Límite de tiempo de las Edge Functions.** Mitigación: descargas limitadas por corrida; lo pendiente sigue en la próxima.

## 8. Nota sobre los procesos del INS y de la Dirección de Veteranos

Revisamos los documentos de los dos. Hoy no se puede ofertar en ninguno:

- **INS (INS-SMC-016-2026, $9,3M, cierra el 7 de octubre):**
  - Pide experiencia en máximo 3 contratos terminados que sumen $9,3M o más.
  - Exige 2 psicólogos con especialización en SST, licencia, 2 años de experiencia con la batería y curso de 50 horas.
  - Son 400 servidores (~$23.250 por persona) y un solo pago al final.
  - Persona natural sí puede participar.
- **Dirección de Veteranos (MC 080/2026, $36M):** es un programa de intervención con coach certificado, psicólogo clínico, psicólogo organizacional y psicólogo SST, más una actividad de aventura para 150 personas con transporte y atención prehospitalaria. Pide experiencia por $36M.

**El cuello de botella es la experiencia acreditada.** Lo que sí está al alcance hoy son contratos pequeños de batería en hospitales públicos y empresas de servicios públicos ($1M–$6M), muchos contratados directamente con una psicóloga. Mientras tanto, hay que formalizar cada venta privada con contrato escrito y certificado de cumplimiento, para ir sumando experiencia.
