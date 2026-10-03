-- Programa la sincronización de SECOP con pg_cron + pg_net.
-- 07:00 y 16:30 hora Colombia (UTC-5) = 12:00 y 21:30 UTC. Socrata recarga el
-- dataset entre las 12:00 y las 15:30 (hora Colombia), así que la corrida de la
-- tarde trae los datos del día y la de la mañana reintenta descargas pendientes.
--
-- Antes de aplicar esta migración hay que guardar dos secretos en Vault
-- (Supabase → Project Settings → Vault, o por SQL):
--   select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/secop-sync', 'secop_sync_url');
--   select vault.create_secret('<mismo valor que SECOP_CRON_SECRET>', 'secop_cron_secret');

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

create or replace function public.secop_disparar_sync()
returns bigint
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  v_url    text;
  v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'secop_sync_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'secop_cron_secret';
  if v_url is null or v_secret is null then
    raise warning 'secop_disparar_sync: faltan los secretos secop_sync_url / secop_cron_secret en Vault';
    return null;
  end if;
  return net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 300000
  );
end;
$$;

revoke all on function public.secop_disparar_sync() from public, anon, authenticated;

select cron.unschedule(jobname) from cron.job where jobname in ('secop-sync-manana', 'secop-sync-tarde');
select cron.schedule('secop-sync-manana', '0 12 * * *',  $$select public.secop_disparar_sync()$$);
select cron.schedule('secop-sync-tarde',  '30 21 * * *', $$select public.secop_disparar_sync()$$);
