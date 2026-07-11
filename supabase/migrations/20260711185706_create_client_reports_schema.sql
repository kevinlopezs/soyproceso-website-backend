-- Client Reports ("Informes"): private per-company report landing pages.
-- Admin uploads a presentation file for a company; a public slug + short code
-- gate access. RLS blocks all public table access; the public flow goes
-- exclusively through the verify_client_report_access() SECURITY DEFINER RPC.

create table if not exists public.client_reports (
  id uuid primary key default gen_random_uuid(),
  company_name text not null,
  application_date date not null,
  presentation_url text not null,
  presentation_path text,
  access_slug text not null unique,
  access_code text not null,
  is_active boolean not null default true,
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists client_reports_access_slug_idx on public.client_reports (access_slug);

alter table public.client_reports enable row level security;

create policy "Admins manage client_reports"
  on public.client_reports
  for all
  using (
    auth.uid() in (select id from public.profiles where email like '%@admin.soyproceso.com' or email = 'admin@soyproceso.com')
    or auth.jwt() ->> 'role' = 'service_role'
  )
  with check (
    auth.uid() in (select id from public.profiles where email like '%@admin.soyproceso.com' or email = 'admin@soyproceso.com')
    or auth.jwt() ->> 'role' = 'service_role'
  );

-- Public / anon has NO direct policy on this table (no select/insert/update/delete)
-- so the anon key cannot read companies, codes, or presentation URLs directly.

create or replace function public.verify_client_report_access(p_slug text, p_code text)
returns table (
  success boolean,
  error_code text,
  company_name text,
  application_date date,
  presentation_url text
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
    return query select false, 'not_found', null::text, null::date, null::text;
    return;
  end if;

  if v_report.locked_until is not null and v_report.locked_until > now() then
    return query select false, 'locked', null::text, null::date, null::text;
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
    return query select false, 'invalid_code', null::text, null::date, null::text;
    return;
  end if;

  update public.client_reports set failed_attempts = 0, locked_until = null where id = v_report.id;

  return query select true, null::text, v_report.company_name, v_report.application_date, v_report.presentation_url;
end;
$$;

revoke all on function public.verify_client_report_access(text, text) from public;
grant execute on function public.verify_client_report_access(text, text) to anon, authenticated;
