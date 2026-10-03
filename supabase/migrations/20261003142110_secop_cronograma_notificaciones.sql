-- Licitaciones SECOP, segunda parte:
--   * Más datos de Socrata (cierre de ofertas, apertura, tipo de contrato, UNSPSC, noticeUID).
--   * Cronograma y documentos capturados de la ficha pública de SECOP II. La ficha pide
--     reCAPTCHA, así que la captura la hace el navegador del equipo (marcador del panel)
--     y llega aquí por la función secop_guardar_ficha.
--   * Notificaciones dentro del panel: eventos leídos/no leídos y Realtime.

-- 1. Columnas nuevas en procesos ------------------------------------------------------
alter table public.secop_procesos
  add column if not exists notice_uid              text,          -- CO1.NTC.xxxx (ficha pública)
  add column if not exists fecha_recepcion_ofertas timestamptz,   -- Socrata: fecha_de_recepcion_de (sin hora)
  add column if not exists fecha_apertura_ofertas  timestamptz,
  add column if not exists tipo_contrato           text,
  add column if not exists codigo_unspsc           text,
  add column if not exists ficha                   jsonb,         -- última captura de la ficha pública
  add column if not exists ficha_capturada         timestamptz;

update public.secop_procesos
set notice_uid = substring(url from 'noticeUID=(CO1\.NTC\.[0-9]+)')
where notice_uid is null and url is not null;

create index if not exists secop_procesos_notice_idx on public.secop_procesos (notice_uid);
create index if not exists secop_procesos_cierre_idx on public.secop_procesos (fecha_cierre)
  where fecha_cierre is not null;

alter table public.secop_procesos drop constraint if exists secop_procesos_categoria_check;
alter table public.secop_procesos add constraint secop_procesos_categoria_check
  check (categoria in ('bateria','intervencion','vigilancia','convivencia','pap','clima','capacitacion','otro'));

-- Momento de la última recarga de Socrata que leyó cada corrida (rowsUpdatedAt). Si no cambió,
-- la corrida programada se salta la lectura completa del dataset.
alter table public.secop_sync_runs
  add column if not exists fuente_actualizada bigint,
  add column if not exists modo text;

-- 2. Cronograma -------------------------------------------------------------------------
create table if not exists public.secop_cronograma (
  id_proceso   text not null references public.secop_procesos (id_proceso) on delete cascade,
  etiqueta     text not null,                 -- "Presentación de Ofertas", "Apertura de sobres"…
  orden        integer not null default 0,
  fecha        timestamptz,                   -- null si SECOP no trae una fecha legible
  texto        text,                          -- texto tal cual de SECOP
  actualizado  timestamptz not null default now(),
  primary key (id_proceso, etiqueta)
);

create index if not exists secop_cronograma_fecha_idx on public.secop_cronograma (fecha)
  where fecha is not null;

alter table public.secop_cronograma enable row level security;
drop policy if exists "equipo lee cronograma" on public.secop_cronograma;
create policy "equipo lee cronograma" on public.secop_cronograma
  for select to authenticated using (true);

-- 3. Documentos: de dónde salieron ------------------------------------------------------
alter table public.secop_documentos
  add column if not exists origen text not null default 'socrata'
    check (origen in ('socrata', 'portal'));

-- 4. Eventos: tipos nuevos y notificaciones leídas ---------------------------------------
alter table public.secop_eventos drop constraint if exists secop_eventos_tipo_check;
alter table public.secop_eventos add constraint secop_eventos_tipo_check
  check (tipo in ('nuevo','cambio','documento','recordatorio_cierre','cronograma','hito'));

alter table public.secop_eventos add column if not exists leido boolean not null default false;

-- Lo cargado antes de esta migración no aparece como notificación pendiente.
update public.secop_eventos set leido = true where creado < now();

create index if not exists secop_eventos_no_leidos_idx on public.secop_eventos (creado desc)
  where leido = false;

drop policy if exists "equipo marca eventos leidos" on public.secop_eventos;
create policy "equipo marca eventos leidos" on public.secop_eventos
  for update to authenticated using (true) with check (true);
revoke update on public.secop_eventos from authenticated;
grant update (leido) on public.secop_eventos to authenticated;

-- Realtime: la campana del panel se entera de los eventos nuevos sin recargar.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'secop_eventos'
  ) then
    alter publication supabase_realtime add table public.secop_eventos;
  end if;
end $$;

-- 5. Guardar una captura de la ficha pública ---------------------------------------------
-- p_ficha (lo arma el marcador del panel en community.secop.gov.co):
-- {
--   "noticeUid": "CO1.NTC.123",
--   "info": { "fase": "...", "estado": "...", "referencia": "...", ... },
--   "cronograma": [ { "etiqueta": "...", "fecha": "2026-10-07T12:00:00-05:00" | null, "texto": "..." } ],
--   "documentos": [ { "id": "863309868", "nombre": "...", "url": "https://community.secop.gov.co/..." } ]
-- }
-- Registra como eventos los cambios de fechas del cronograma y los documentos nuevos.
create or replace function public.secop_guardar_ficha(p_ficha jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_notice   text := p_ficha ->> 'noticeUid';
  v_id       text;
  v_primera  boolean;
  v_item     jsonb;
  v_orden    integer := 0;
  v_fecha    timestamptz;
  v_anterior record;
  v_cambios  integer := 0;
  v_docs     integer := 0;
  v_cierre   timestamptz;
begin
  if auth.uid() is null then
    raise exception 'No autorizado';
  end if;
  if v_notice is null or v_notice !~ '^CO1\.NTC\.[0-9]+$' then
    raise exception 'La captura no trae un noticeUID válido';
  end if;

  select id_proceso, ficha_capturada is null
    into v_id, v_primera
  from secop_procesos
  where notice_uid = v_notice
  limit 1;
  if v_id is null then
    raise exception 'El proceso % no está en el monitor', v_notice;
  end if;

  -- Cronograma: upsert por etiqueta y evento cuando cambia una fecha ya conocida.
  for v_item in select * from jsonb_array_elements(coalesce(p_ficha -> 'cronograma', '[]'::jsonb)) loop
    v_orden := v_orden + 1;
    continue when coalesce(trim(v_item ->> 'etiqueta'), '') = '';
    v_fecha := nullif(v_item ->> 'fecha', '')::timestamptz;

    select fecha, texto into v_anterior
    from secop_cronograma
    where id_proceso = v_id and etiqueta = v_item ->> 'etiqueta';

    if found and v_anterior.fecha is distinct from v_fecha and not v_primera then
      insert into secop_eventos (id_proceso, tipo, campo, valor_antes, valor_ahora)
      values (v_id, 'cronograma', v_item ->> 'etiqueta',
              coalesce(to_char(v_anterior.fecha at time zone 'America/Bogota', 'DD/MM/YYYY HH12:MI AM'), v_anterior.texto),
              coalesce(to_char(v_fecha at time zone 'America/Bogota', 'DD/MM/YYYY HH12:MI AM'), v_item ->> 'texto'));
      v_cambios := v_cambios + 1;
    end if;

    insert into secop_cronograma (id_proceso, etiqueta, orden, fecha, texto, actualizado)
    values (v_id, v_item ->> 'etiqueta', v_orden, v_fecha, v_item ->> 'texto', now())
    on conflict (id_proceso, etiqueta) do update
      set orden = excluded.orden, fecha = excluded.fecha, texto = excluded.texto, actualizado = now();

    if v_fecha is not null and (v_item ->> 'etiqueta') ~* '^presentaci[oó]n de (ofertas|propuestas)' then
      v_cierre := v_fecha;
    end if;
  end loop;

  -- Documentos vistos en la ficha (Socrata los publica con días de retraso).
  for v_item in select * from jsonb_array_elements(coalesce(p_ficha -> 'documentos', '[]'::jsonb)) loop
    continue when coalesce(v_item ->> 'id', '') !~ '^[0-9]{1,20}$';
    insert into secop_documentos (id_documento, id_proceso, nombre, url_origen, origen)
    values (v_item ->> 'id', v_id, coalesce(nullif(v_item ->> 'nombre', ''), 'Documento ' || (v_item ->> 'id')),
            'https://community.secop.gov.co/Public/Archive/RetrieveFile/Index?DocumentId=' || (v_item ->> 'id'), 'portal')
    on conflict (id_documento) do nothing;
    if found then
      v_docs := v_docs + 1;
      if not v_primera then
        insert into secop_eventos (id_proceso, tipo, valor_ahora)
        values (v_id, 'documento', coalesce(nullif(v_item ->> 'nombre', ''), 'Documento ' || (v_item ->> 'id')));
      end if;
    end if;
  end loop;

  -- La fecha de presentación de ofertas del cronograma es la fecha de cierre oficial.
  update secop_procesos
  set ficha = p_ficha -> 'info',
      ficha_capturada = now(),
      fecha_cierre = coalesce(v_cierre, fecha_cierre)
  where id_proceso = v_id;

  return jsonb_build_object(
    'id_proceso', v_id,
    'cambios_cronograma', v_cambios,
    'documentos_nuevos', v_docs,
    'fecha_cierre', v_cierre
  );
end;
$$;

revoke all on function public.secop_guardar_ficha(jsonb) from public, anon;
grant execute on function public.secop_guardar_ficha(jsonb) to authenticated;
