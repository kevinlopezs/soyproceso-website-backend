-- La ficha de SECOP II dice si un proceso ya no recibe ofertas (contrato firmado, adjudicado…),
-- algo que los datos abiertos de régimen especial no muestran. secop_guardar_ficha lo marca en
-- ficha_cerrada y el panel lo saca de "Abiertos".

alter table public.secop_procesos add column if not exists ficha_cerrada boolean not null default false;

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
  v_cerrada  boolean := false;
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

    -- Un contrato ya firmado o en ejecución no recibe ofertas, aunque los datos abiertos digan "Publicado".
    if v_fecha is not null and v_fecha < now()
       and (v_item ->> 'etiqueta') ~* '(firma del contrato|inicio de ejecuci|aceptaci[oó]n de (la )?oferta|adjudicaci)' then
      v_cerrada := true;
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

  -- El estado que muestra la ficha también puede decir que ya se cerró.
  if coalesce(p_ficha -> 'info' ->> 'estado', '') ~* '(adjudicad|celebrad|cerrad|cancelad|desiert|seleccionad|terminad|evaluaci)' then
    v_cerrada := true;
  end if;

  -- La fecha de presentación de ofertas del cronograma es la fecha de cierre oficial.
  update secop_procesos
  set ficha = p_ficha -> 'info',
      ficha_capturada = now(),
      ficha_cerrada = v_cerrada,
      fecha_cierre = coalesce(v_cierre, fecha_cierre)
  where id_proceso = v_id;

  return jsonb_build_object(
    'id_proceso', v_id,
    'cambios_cronograma', v_cambios,
    'documentos_nuevos', v_docs,
    'fecha_cierre', v_cierre,
    'cerrado', v_cerrada
  );
end;
$$;

-- Procesos ya capturados: se recalcula con lo guardado.
update public.secop_procesos p set ficha_cerrada = true
where exists (
  select 1 from public.secop_cronograma c
  where c.id_proceso = p.id_proceso and c.fecha < now()
    and c.etiqueta ~* '(firma del contrato|inicio de ejecuci|aceptaci[oó]n de (la )?oferta|adjudicaci)'
);

revoke all on function public.secop_guardar_ficha(jsonb) from public, anon;
grant execute on function public.secop_guardar_ficha(jsonb) to authenticated;
