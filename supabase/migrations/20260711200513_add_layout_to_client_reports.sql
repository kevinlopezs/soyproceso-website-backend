-- Lets a specific report render a bespoke, hand-built landing page (a
-- registry key resolved client-side) instead of the generic PDF/PPTX
-- viewer. Default 'document' keeps today's generic behavior for every
-- existing/future report; the original file stays available as an
-- optional download regardless of layout.
alter table public.client_reports
  add column if not exists layout text not null default 'document';

drop function if exists public.verify_client_report_access(text, text);

create or replace function public.verify_client_report_access(p_slug text, p_code text)
returns table (
  success boolean,
  error_code text,
  report_id uuid,
  company_name text,
  application_date date,
  application_date_precision text,
  presentation_url text,
  layout text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_report public.client_reports%rowtype;
begin
  select * into v_report from public.client_reports where access_slug = p_slug;

  if not found or not v_report.is_active then
    return query select false, 'not_found', null::uuid, null::text, null::date, null::text, null::text, null::text;
    return;
  end if;

  if v_report.locked_until is not null and v_report.locked_until > now() then
    return query select false, 'locked', null::uuid, null::text, null::date, null::text, null::text, null::text;
    return;
  end if;

  if v_report.locked_until is not null and v_report.locked_until <= now() then
    update public.client_reports set failed_attempts = 0, locked_until = null where id = v_report.id;
    v_report.failed_attempts := 0;
  end if;

  if upper(trim(p_code)) <> v_report.access_code then
    update public.client_reports
      set failed_attempts = failed_attempts + 1,
          locked_until = case when failed_attempts + 1 >= 5 then now() + interval '15 minutes' else locked_until end
      where id = v_report.id;
    return query select false, 'invalid_code', null::uuid, null::text, null::date, null::text, null::text, null::text;
    return;
  end if;

  update public.client_reports set failed_attempts = 0, locked_until = null where id = v_report.id;

  return query select
    true, null::text, v_report.id, v_report.company_name,
    v_report.application_date, v_report.application_date_precision,
    v_report.presentation_url, v_report.layout;
end;
$$;

revoke all on function public.verify_client_report_access(text, text) from public;
grant execute on function public.verify_client_report_access(text, text) to anon, authenticated;

update public.client_reports set layout = 'sain-inversiones-2026' where access_slug = 'sain-lubricantes-junio-2026';
