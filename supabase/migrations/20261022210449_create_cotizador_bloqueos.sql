-- Lista de bloqueo del cotizador: correos, dominios o IPs que hacen spam.
-- La edge function cotizador-lead la revisa antes de generar la cotización y, si hay
-- coincidencia, guarda el lead como 'perdido' sin enviar correo ni avisar al equipo.
create table public.cotizador_bloqueos (
  id          uuid primary key default gen_random_uuid(),
  tipo        text not null check (tipo in ('email', 'dominio', 'ip')),
  valor       text not null,
  motivo      text,
  created_at  timestamptz not null default now(),
  unique (tipo, valor)
);

alter table public.cotizador_bloqueos enable row level security;

-- Misma convención del resto del panel: cualquier sesión autenticada es el equipo.
create policy "Authenticated users read cotizador_bloqueos"
  on public.cotizador_bloqueos for select to authenticated using (true);
create policy "Authenticated users insert cotizador_bloqueos"
  on public.cotizador_bloqueos for insert to authenticated with check (true);
create policy "Authenticated users delete cotizador_bloqueos"
  on public.cotizador_bloqueos for delete to authenticated using (true);

comment on table public.cotizador_bloqueos is
  'Correos, dominios e IPs bloqueados en el cotizador (spam). Los lee la edge function cotizador-lead.';

insert into public.cotizador_bloqueos (tipo, valor, motivo) values
  ('email', 'septyd@septyd.com', 'Spam: 4 cotizaciones en 11 minutos el 22 de octubre de 2026'),
  ('dominio', 'septyd.com', 'Spam: 4 cotizaciones en 11 minutos el 22 de octubre de 2026'),
  ('ip', '190.249.215.215', 'Spam: 4 cotizaciones en 11 minutos el 22 de octubre de 2026');
