# Licitaciones SECOP: backend

El plan completo está en [plan-monitor-secop.md](./plan-monitor-secop.md). Aquí solo va cómo se pone en marcha.

## Piezas

| Archivo | Qué hace |
|---|---|
| `supabase/migrations/20261002120000_secop_monitor.sql` | Tablas `secop_procesos`, `secop_eventos`, `secop_documentos`, `secop_sync_runs`, RLS y bucket privado `secop-documentos` |
| `supabase/migrations/20261003120000_secop_sync_cron.sql` | pg_cron: 07:00 y 16:30 hora Colombia llaman a `secop-sync` con pg_net |
| `supabase/functions/secop-sync/` | Lee Socrata (`p6dx-8zbt` procesos, `dmgg-8hin` documentos), detecta cambios, descarga documentos y avisa |
| `supabase/functions/_shared/secop-rules.ts` | Filtros (modalidad, tema laboral, exclusiones) y categoría de cada proceso |
| `supabase/functions/_shared/notify.ts` | Avisos por Telegram y Amazon SES |

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
