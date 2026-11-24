-- Informes semanales de rendimiento en Google: se guardan para compararlos con el siguiente y hacer seguimiento
-- de las recomendaciones. Solo lectura para el admin; escribe la Edge Function (service role).
create table if not exists public.gsc_weekly_reports (
  id uuid primary key default gen_random_uuid(),
  fecha_inicio date not null,
  fecha_fin date not null,
  datos jsonb not null,
  ia jsonb,
  enviado_a text[] not null default '{}',
  created_at timestamptz not null default now()
);
alter table public.gsc_weekly_reports enable row level security;
drop policy if exists "Admin lee informes" on public.gsc_weekly_reports;
create policy "Admin lee informes" on public.gsc_weekly_reports for select to authenticated using (public.is_admin());

-- Lunes 7:00 a. m. hora Colombia = 12:00 UTC. Secreto en Vault: blog_weekly_report_url
--   select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/blog-weekly-report', 'blog_weekly_report_url');
create or replace function public.blog_disparar_reporte_semanal()
returns bigint
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'blog_weekly_report_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'blog_on_publish_secret';
  if v_url is null or v_secret is null then
    raise warning 'blog_disparar_reporte_semanal: faltan blog_weekly_report_url / blog_on_publish_secret en Vault';
    return null;
  end if;
  return net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-publish-secret', v_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 150000
  );
end;
$$;
revoke all on function public.blog_disparar_reporte_semanal() from public, anon, authenticated;

select cron.unschedule(jobname) from cron.job where jobname = 'blog-reporte-semanal';
select cron.schedule('blog-reporte-semanal', '0 12 * * 1', $$select public.blog_disparar_reporte_semanal()$$);
