-- "Planes Respiro": después de la batería de riesgo psicosocial, cada informe
-- puede ofrecer al cliente los planes de acompañamiento continuo de Soy Proceso.
-- El admin decide, por informe y en tiempo real, si se muestran los planes y
-- cuál es el recomendado (el que se despliega primero y destacado en el enlace).
--   - show_respiro_plans: interruptor maestro por informe.
--   - recommended_plan: 'esencial' ($200k), 'activo' ($500k) o 'integral' ($1M).
alter table public.client_reports
  add column if not exists show_respiro_plans boolean not null default false;

alter table public.client_reports
  add column if not exists recommended_plan text
    check (recommended_plan is null or recommended_plan in ('esencial', 'activo', 'integral'));

-- Extend the access-gate RPC to also return the respiro-plan config so the
-- unlocked client view knows what to render right after the presentation.
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
  layout text,
  show_respiro_plans boolean,
  recommended_plan text
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
    return query select false, 'not_found', null::uuid, null::text, null::date, null::text, null::text, null::text, null::boolean, null::text;
    return;
  end if;

  if v_report.locked_until is not null and v_report.locked_until > now() then
    return query select false, 'locked', null::uuid, null::text, null::date, null::text, null::text, null::text, null::boolean, null::text;
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
    return query select false, 'invalid_code', null::uuid, null::text, null::date, null::text, null::text, null::text, null::boolean, null::text;
    return;
  end if;

  update public.client_reports set failed_attempts = 0, locked_until = null where id = v_report.id;

  return query select
    true, null::text, v_report.id, v_report.company_name,
    v_report.application_date, v_report.application_date_precision,
    v_report.presentation_url, v_report.layout,
    v_report.show_respiro_plans, v_report.recommended_plan;
end;
$$;

revoke all on function public.verify_client_report_access(text, text) from public;
grant execute on function public.verify_client_report_access(text, text) to anon, authenticated;

-- Lightweight, non-sensitive config lookup used by the unlocked client view to
-- refresh the respiro-plan state on every load (real-time toggling from admin),
-- independent of the sessionStorage-cached access payload. Only exposes whether
-- to show plans and which one is recommended — never any report data or code.
create or replace function public.get_respiro_config(p_slug text)
returns table (
  show_respiro_plans boolean,
  recommended_plan text
)
language sql
security definer
set search_path = public
as $$
  select show_respiro_plans, recommended_plan
  from public.client_reports
  where access_slug = p_slug and is_active = true;
$$;

revoke all on function public.get_respiro_config(text) from public;
grant execute on function public.get_respiro_config(text) to anon, authenticated;
