-- Monitor de SECOP II: procesos psicosociales, sus cambios y sus documentos.
-- La función secop-sync escribe con la service role; el panel de admin lee y
-- actualiza el seguimiento con usuarios autenticados.

create table if not exists public.secop_procesos (
  id_proceso               text primary key,              -- CO1.REQ.xxxx
  id_portafolio            text,                          -- CO1.BDOS.xxxx (enlaza documentos)
  referencia               text,
  entidad                  text,
  nit_entidad              text,
  departamento             text,
  ciudad                   text,
  nombre                   text,
  descripcion              text,
  modalidad                text,
  fase                     text,
  estado                   text,
  estado_resumen           text,
  precio_base              numeric,
  fecha_publicacion        timestamptz,
  fecha_ultima_publicacion timestamptz,
  duracion                 text,
  manifestaciones          integer,
  respuestas               integer,
  adjudicado               boolean default false,
  proveedor_adjudicado     text,
  valor_adjudicado         numeric,
  url                      text,
  categoria                text not null default 'otro'
    check (categoria in ('bateria','intervencion','vigilancia','convivencia','pap','clima','otro')),
  apto                     boolean not null default false,
  motivo_no_apto           text,

  -- Lo maneja el equipo desde el panel
  seguimiento              text not null default 'nuevo'
    check (seguimiento in ('nuevo','revisando','ofertar','ofertado','descartado','ganado','perdido')),
  fecha_cierre             timestamptz,                   -- se copia a mano desde SECOP II
  notas                    text,

  primera_vez              timestamptz not null default now(),
  ultima_sincronizacion    timestamptz not null default now()
);

create index if not exists secop_procesos_apto_idx on public.secop_procesos (apto, fecha_publicacion desc);
create index if not exists secop_procesos_seguimiento_idx on public.secop_procesos (seguimiento);
create index if not exists secop_procesos_portafolio_idx on public.secop_procesos (id_portafolio);

create table if not exists public.secop_eventos (
  id           bigint generated always as identity primary key,
  id_proceso   text not null references public.secop_procesos (id_proceso) on delete cascade,
  tipo         text not null check (tipo in ('nuevo','cambio','documento','recordatorio_cierre')),
  campo        text,
  valor_antes  text,
  valor_ahora  text,
  creado       timestamptz not null default now(),
  notificado   boolean not null default false
);

create index if not exists secop_eventos_proceso_idx on public.secop_eventos (id_proceso, creado desc);
create index if not exists secop_eventos_pendientes_idx on public.secop_eventos (notificado) where notificado = false;

create table if not exists public.secop_documentos (
  id_documento  text primary key,
  id_proceso    text not null references public.secop_procesos (id_proceso) on delete cascade,
  nombre        text not null,
  extension     text,
  tamano        bigint,
  fecha_carga   timestamptz,
  url_origen    text,
  storage_path  text,                                    -- null mientras no se descargue
  error_descarga text,
  creado        timestamptz not null default now()
);

create index if not exists secop_documentos_proceso_idx on public.secop_documentos (id_proceso);

create table if not exists public.secop_sync_runs (
  id          bigint generated always as identity primary key,
  inicio      timestamptz not null default now(),
  fin         timestamptz,
  ok          boolean,
  leidos      integer default 0,
  nuevos      integer default 0,
  cambios     integer default 0,
  documentos  integer default 0,
  descargas   integer default 0,
  error       text
);

-- RLS: solo usuarios autenticados (el equipo) leen y editan el seguimiento.
alter table public.secop_procesos  enable row level security;
alter table public.secop_eventos    enable row level security;
alter table public.secop_documentos enable row level security;
alter table public.secop_sync_runs  enable row level security;

create policy "equipo lee procesos" on public.secop_procesos
  for select to authenticated using (true);
create policy "equipo actualiza seguimiento" on public.secop_procesos
  for update to authenticated using (true) with check (true);
create policy "equipo lee eventos" on public.secop_eventos
  for select to authenticated using (true);
create policy "equipo lee documentos" on public.secop_documentos
  for select to authenticated using (true);
create policy "equipo lee corridas" on public.secop_sync_runs
  for select to authenticated using (true);

-- El equipo solo puede cambiar las columnas de seguimiento; el resto lo escribe la sincronización.
revoke update on public.secop_procesos from authenticated;
grant update (seguimiento, fecha_cierre, notas) on public.secop_procesos to authenticated;

-- Bucket privado para los documentos de los procesos.
insert into storage.buckets (id, name, public)
values ('secop-documentos', 'secop-documentos', false)
on conflict (id) do nothing;

create policy "equipo descarga documentos secop" on storage.objects
  for select to authenticated using (bucket_id = 'secop-documentos');
