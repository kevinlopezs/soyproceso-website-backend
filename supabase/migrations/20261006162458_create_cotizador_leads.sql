-- Cotizador automático de la batería de riesgo psicosocial (landing de Google Ads,
-- campaña "venta de baterías Q2 · cierre 2026"). Cada visita crea una fila al cargar la
-- landing y la va completando paso a paso; al final queda un lead con una cotización
-- estimada pendiente de verificar por el equipo.
-- Solo la edge function cotizador-lead (service role) escribe; el panel (authenticated) lee
-- y actualiza el estado comercial.

create table public.cotizador_leads (
  id                  uuid primary key default gen_random_uuid(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  -- Experimento A/B y origen
  variante            text not null default 'a' check (variante in ('a', 'b')),
  landing             text,                         -- ruta de la landing (/cotizador-bateria)
  utm_source          text,
  utm_medium          text,
  utm_campaign        text,
  utm_term            text,
  utm_content         text,
  gclid               text,
  gbraid              text,
  wbraid              text,
  referrer            text,
  ip_address          text,
  user_agent          text,

  -- Embudo
  ultimo_paso         text not null default 'video',
  video_max_pct       smallint not null default 0 check (video_max_pct between 0 and 100),
  video_completo      boolean not null default false,

  -- Respuestas
  trabajadores_exacto integer check (trabajadores_exacto > 0),
  trabajadores_rango  text,
  trabajadores_min    integer,
  trabajadores_max    integer,                      -- null = rango abierto ("más de 500")
  modalidad           text check (modalidad in ('virtual', 'presencial', 'ambas')),
  ciudad              text,
  canal_envio         text check (canal_envio in ('correo', 'whatsapp', 'ambos')),
  email               text,
  whatsapp            text,                         -- 10 dígitos, celular colombiano (3XXXXXXXXX)
  nombre              text,
  empresa             text,
  autoriza_datos      boolean not null default false,
  autoriza_datos_at   timestamptz,

  -- Resultado
  estimacion          jsonb,                        -- rango estimado mostrado al usuario
  completed_at        timestamptz,
  email_enviado       boolean not null default false,
  equipo_notificado   boolean not null default false,

  -- Seguimiento comercial
  estado              text not null default 'en_progreso'
                      check (estado in ('en_progreso', 'cotizacion_generada', 'contactado',
                                        'cotizacion_enviada', 'ganado', 'perdido')),
  notas               text
);

create index cotizador_leads_created_idx on public.cotizador_leads (created_at desc);
create index cotizador_leads_estado_idx on public.cotizador_leads (estado);
create index cotizador_leads_campaign_idx on public.cotizador_leads (utm_campaign, variante);

create or replace function public.cotizador_leads_touch()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger cotizador_leads_touch
  before update on public.cotizador_leads
  for each row execute function public.cotizador_leads_touch();

alter table public.cotizador_leads enable row level security;

-- Misma convención del resto del panel: cualquier sesión autenticada es el equipo.
create policy "Authenticated users read cotizador_leads"
  on public.cotizador_leads for select to authenticated using (true);
create policy "Authenticated users update cotizador_leads"
  on public.cotizador_leads for update to authenticated using (true) with check (true);

comment on table public.cotizador_leads is
  'Leads del cotizador automático de la batería (landing Google Ads, test A/B). Escribe la edge function cotizador-lead.';

-- Embudo por variante para comparar el A/B.
create or replace view public.cotizador_embudo
with (security_invoker = true) as
select
  coalesce(utm_campaign, '(sin campaña)')               as campana,
  variante,
  count(*)                                              as visitas,
  count(*) filter (where video_max_pct >= 70)           as video_70,
  count(*) filter (where video_completo)                as video_completo,
  count(*) filter (where trabajadores_min is not null)  as respondio_trabajadores,
  count(*) filter (where modalidad is not null)         as respondio_modalidad,
  count(*) filter (where ciudad is not null)            as respondio_ciudad,
  count(*) filter (where canal_envio is not null)       as eligio_canal,
  count(*) filter (where completed_at is not null)      as leads,
  round(100.0 * count(*) filter (where completed_at is not null) / nullif(count(*), 0), 1)
                                                        as conversion_pct
from public.cotizador_leads
group by 1, 2;
