-- Eventos por destinatario publicados por Amazon SES desde soyproceso.com.
-- Flujo: configuration set soyproceso-eventos (default del dominio) -> SNS ses-eventos-soyproceso
-- -> edge function ses-events -> esta tabla. Un correo sin evento 'Send' nunca salió de SES.
create table public.ses_events (
  id bigint generated always as identity primary key,
  event_type text not null,
  message_id text not null,
  recipient text not null,
  source text,
  subject text,
  configuration_set text,
  sent_at timestamptz,
  event_at timestamptz not null,
  bounce_type text,
  bounce_subtype text,
  detail jsonb,
  received_at timestamptz not null default now(),
  constraint ses_events_unique unique (message_id, event_type, recipient)
);

create index ses_events_recipient_idx on public.ses_events (recipient);
create index ses_events_sent_at_idx on public.ses_events (sent_at);
create index ses_events_subject_idx on public.ses_events (subject);

alter table public.ses_events enable row level security;
-- Sin políticas: solo la edge function (service role) escribe y lee.

comment on table public.ses_events is
  'Eventos por destinatario publicados por Amazon SES (config set soyproceso-eventos -> SNS -> edge function ses-events). Fuente de verdad de envío/entrega independiente de Sendy.';
