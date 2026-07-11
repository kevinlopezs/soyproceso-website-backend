-- Client feedback survey: admin-configured questions, answered by the company
-- contact after unlocking their report. All public writes go through the
-- submit_feedback() SECURITY DEFINER RPC — no direct anon policies on these
-- tables, same defense-in-depth pattern as client_reports.

create table if not exists public.feedback_questions (
  id uuid primary key default gen_random_uuid(),
  question_text text not null,
  question_type text not null default 'rating' check (question_type in ('rating', 'choice', 'text')),
  options jsonb,
  order_index integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.feedback_responses (
  id uuid primary key default gen_random_uuid(),
  client_report_id uuid not null references public.client_reports(id) on delete cascade,
  respondent_name text not null,
  created_at timestamptz not null default now()
);

create index if not exists feedback_responses_client_report_id_idx on public.feedback_responses (client_report_id);

create table if not exists public.feedback_answers (
  id uuid primary key default gen_random_uuid(),
  feedback_response_id uuid not null references public.feedback_responses(id) on delete cascade,
  question_id uuid references public.feedback_questions(id) on delete set null,
  question_text_snapshot text not null,
  answer_value text not null,
  created_at timestamptz not null default now()
);

create index if not exists feedback_answers_response_id_idx on public.feedback_answers (feedback_response_id);

alter table public.feedback_questions enable row level security;
alter table public.feedback_responses enable row level security;
alter table public.feedback_answers enable row level security;

create policy "Admins manage feedback_questions"
  on public.feedback_questions for all
  using (
    auth.uid() in (select id from public.profiles where email like '%@admin.soyproceso.com' or email = 'admin@soyproceso.com')
    or auth.jwt() ->> 'role' = 'service_role'
  )
  with check (
    auth.uid() in (select id from public.profiles where email like '%@admin.soyproceso.com' or email = 'admin@soyproceso.com')
    or auth.jwt() ->> 'role' = 'service_role'
  );

create policy "Admins manage feedback_responses"
  on public.feedback_responses for all
  using (
    auth.uid() in (select id from public.profiles where email like '%@admin.soyproceso.com' or email = 'admin@soyproceso.com')
    or auth.jwt() ->> 'role' = 'service_role'
  )
  with check (
    auth.uid() in (select id from public.profiles where email like '%@admin.soyproceso.com' or email = 'admin@soyproceso.com')
    or auth.jwt() ->> 'role' = 'service_role'
  );

create policy "Admins manage feedback_answers"
  on public.feedback_answers for all
  using (
    auth.uid() in (select id from public.profiles where email like '%@admin.soyproceso.com' or email = 'admin@soyproceso.com')
    or auth.jwt() ->> 'role' = 'service_role'
  )
  with check (
    auth.uid() in (select id from public.profiles where email like '%@admin.soyproceso.com' or email = 'admin@soyproceso.com')
    or auth.jwt() ->> 'role' = 'service_role'
  );

create or replace function public.submit_feedback(p_report_id uuid, p_respondent_name text, p_answers jsonb)
returns table (success boolean, error_code text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_report public.client_reports%rowtype;
  v_response_id uuid;
  v_name text;
  v_item jsonb;
  v_question public.feedback_questions%rowtype;
  v_answer_value text;
  v_inserted_any boolean := false;
begin
  select * into v_report from public.client_reports where id = p_report_id;
  if not found or not v_report.is_active then
    return query select false, 'not_found';
    return;
  end if;

  v_name := trim(coalesce(p_respondent_name, ''));
  if v_name = '' or length(v_name) > 120 then
    return query select false, 'invalid_name';
    return;
  end if;

  if p_answers is null or jsonb_typeof(p_answers) <> 'array' or jsonb_array_length(p_answers) = 0 then
    return query select false, 'invalid_answers';
    return;
  end if;

  insert into public.feedback_responses (client_report_id, respondent_name)
  values (p_report_id, v_name)
  returning id into v_response_id;

  for v_item in select * from jsonb_array_elements(p_answers)
  loop
    select * into v_question
      from public.feedback_questions
      where id = (v_item->>'question_id')::uuid and is_active = true;

    if not found then
      continue;
    end if;

    v_answer_value := trim(coalesce(v_item->>'answer_value', ''));
    if v_answer_value = '' then
      continue;
    end if;

    insert into public.feedback_answers (feedback_response_id, question_id, question_text_snapshot, answer_value)
    values (v_response_id, v_question.id, v_question.question_text, left(v_answer_value, 2000));

    v_inserted_any := true;
  end loop;

  if not v_inserted_any then
    delete from public.feedback_responses where id = v_response_id;
    return query select false, 'invalid_answers';
    return;
  end if;

  return query select true, null::text;
end;
$$;

revoke all on function public.submit_feedback(uuid, text, jsonb) from public;
grant execute on function public.submit_feedback(uuid, text, jsonb) to anon, authenticated;

-- Extend the access-gate RPC to also return the report id (needed to submit
-- feedback) and the application_date_precision (so the client UI doesn't
-- render a fabricated day when only month/year is known).
drop function if exists public.verify_client_report_access(text, text);

create or replace function public.verify_client_report_access(p_slug text, p_code text)
returns table (
  success boolean,
  error_code text,
  report_id uuid,
  company_name text,
  application_date date,
  application_date_precision text,
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
    return query select false, 'not_found', null::uuid, null::text, null::date, null::text, null::text;
    return;
  end if;

  if v_report.locked_until is not null and v_report.locked_until > now() then
    return query select false, 'locked', null::uuid, null::text, null::date, null::text, null::text;
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
    return query select false, 'invalid_code', null::uuid, null::text, null::date, null::text, null::text;
    return;
  end if;

  update public.client_reports set failed_attempts = 0, locked_until = null where id = v_report.id;

  return query select
    true, null::text, v_report.id, v_report.company_name,
    v_report.application_date, v_report.application_date_precision, v_report.presentation_url;
end;
$$;

revoke all on function public.verify_client_report_access(text, text) from public;
grant execute on function public.verify_client_report_access(text, text) to anon, authenticated;

-- Seed a sensible default survey so the feature is usable immediately.
insert into public.feedback_questions (question_text, question_type, options, order_index)
values
  ('¿Qué tan clara y útil te pareció la presentación de resultados?', 'rating', null, 1),
  ('¿Qué tan bien reflejan estos resultados la realidad de tu equipo?', 'rating', null, 2),
  ('¿Qué tan preparada se siente tu empresa para actuar sobre el plan de intervención propuesto?', 'rating', null, 3),
  ('¿Qué fue lo más valioso de este informe para ti?', 'choice',
    '["El diagnóstico general", "El plan de acción", "El comparativo por grupos", "La claridad de la presentación"]'::jsonb, 4),
  ('¿Algo que te gustaría agregar o comentar?', 'text', null, 5)
on conflict do nothing;
