-- Procesos que ya se avisaron como nuevos. Sobrevive al borrado de los procesos cerrados para que
-- un proceso nunca se avise dos veces, aunque Socrata lo vuelva a mostrar.
create table if not exists public.secop_avisados (
  id_proceso text primary key,
  avisado    timestamptz not null default now()
);

alter table public.secop_avisados enable row level security;
-- Sin políticas: solo la sincronización (service role) la usa.

insert into public.secop_avisados (id_proceso, avisado)
select id_proceso, min(creado) from public.secop_eventos where tipo = 'nuevo' group by id_proceso
on conflict (id_proceso) do nothing;
