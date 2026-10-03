# Licitaciones SECOP: backend

El plan completo está en [plan-monitor-secop.md](./plan-monitor-secop.md). Aquí solo va cómo se pone en marcha.

## Piezas

| Archivo | Qué hace |
|---|---|
| `supabase/migrations/20261003142033_secop_monitor.sql` | Tablas `secop_procesos`, `secop_eventos`, `secop_documentos`, `secop_sync_runs`, RLS y bucket privado `secop-documentos` |
| `supabase/migrations/20261003142631_secop_sync_cron.sql` | pg_cron: 07:00 y 16:30 hora Colombia llaman a `secop-sync` con pg_net |
| `supabase/migrations/20261003142110_secop_cronograma_notificaciones.sql` | Cronograma (`secop_cronograma`), columnas nuevas de Socrata (cierre de ofertas, noticeUID, UNSPSC), eventos leídos/no leídos con Realtime y la función `secop_guardar_ficha` |
| `supabase/functions/secop-sync/` | Lee Socrata (`p6dx-8zbt` procesos, `dmgg-8hin` documentos), detecta cambios, recuerda cierres e hitos del cronograma, descarga documentos y avisa. Con `{"modo":"descargas","id_proceso":"…"}` baja ya los documentos de un proceso |
| `supabase/functions/_shared/socrata.ts` | Cliente de Socrata: SODA3 (POST con SoQL) con respaldo SODA 2.1, reintentos en 429/5xx y consulta de la última recarga del dataset |
| `supabase/functions/_shared/secop-rules.ts` | Filtros (modalidad, tema laboral, exclusiones) y categoría de cada proceso según los servicios del portafolio |
| `supabase/functions/_shared/notify.ts` | Avisos por Telegram y Amazon SES |

## Cómo se optimiza la lectura de Socrata

- `$select` con 28 de las 52 columnas del dataset de procesos y 7 del de documentos.
- Antes de leer, se consulta `rowsUpdatedAt` del dataset. Si Socrata no se ha recargado desde la última corrida completa, la corrida programada no vuelve a leerlo (sí revisa recordatorios, descargas y avisos).
- Solo se reescriben en `secop_procesos` las filas nuevas o con algún cambio.
- Documentos en lotes de 80 portafolios por consulta; recordatorios con 3 consultas en paralelo, sin consultas por proceso.

## Cronograma y ficha pública (captcha)

Los datos abiertos no traen el cronograma y la ficha de SECOP II (`community.secop.gov.co`) pide reCAPTCHA a cualquier petición del servidor. Su CSP además bloquea iframes, scripts externos y `fetch` a otros dominios. Por eso la captura la hace el navegador del equipo:

1. En el panel, "Actualizar desde SECOP" abre la ficha en una pestaña nueva.
2. Se resuelve el captcha en SECOP y se toca el marcador **Capturar SECOP** (se instala desde el panel).
3. El marcador lee cronograma, estado y documentos, y los devuelve al panel con `postMessage` (o al portapapeles, si la pestaña perdió la referencia al panel).
4. El panel llama a `secop_guardar_ficha`: guarda el cronograma, registra cambios de fechas y documentos nuevos como eventos y pone como fecha de cierre la de "Presentación de ofertas".

Después, `secop-sync` avisa de los hitos del cronograma de las próximas 48 horas para los procesos en seguimiento.

## Secretos de Edge Functions

| Secreto | Obligatorio | Nota |
|---|---|---|
| `SOCRATA_APP_TOKEN` | Sí | Token de aplicación de datos.gov.co (regenerarlo) |
| `SECOP_CRON_SECRET` | Sí | Cadena aleatoria; el mismo valor va en Vault como `secop_cron_secret` |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Para avisos | Bot de @BotFather y grupo del equipo |
| `SES_ACCESS_KEY_ID`, `SES_SECRET_ACCESS_KEY`, `SES_REGION`, `SECOP_EMAIL_FROM`, `SECOP_EMAIL_TO` | Para avisos | Clave con permiso solo `ses:SendEmail` |
| `SECOP_VENTANA_DIAS` (45), `SECOP_MAX_DESCARGAS` (6), `SECOP_PANEL_URL` | No | Valores por defecto entre paréntesis |

## Orden de despliegue

1. Activar `pg_cron` y `pg_net` (Supabase → Integrations).
2. Guardar en Vault `secop_sync_url` y `secop_cron_secret` (ver encabezado de la migración del cron).
3. `supabase db push`
4. `supabase secrets set ...` con los secretos de arriba.
5. `supabase functions deploy secop-sync`
6. Primera corrida a mano desde el panel ("Sincronizar ahora"): carga 45 días y envía un solo aviso.

## Pruebas

```bash
npm run test:secop   # requiere deno
```
