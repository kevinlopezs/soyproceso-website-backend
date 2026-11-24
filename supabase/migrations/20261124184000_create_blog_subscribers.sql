-- Leads orgánicos del blog + newsletter + estado de indexación en Google.
-- Migración SOLO aditiva: no toca blog_posts ni sus políticas.
--
-- Cada suscriptor es además un usuario de Supabase Auth con rol 'lead' (profiles.role, ver
-- 20261124183133_roles_admin_leads.sql): no tiene ningún permiso, solo existe para identificarlo.
-- Estas tablas las escriben únicamente las Edge Functions (service role); el admin las lee con is_admin().

create table if not exists public.blog_subscribers (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  full_name text,
  avatar_url text,
  google_sub text,
  user_id uuid references auth.users(id) on delete set null,
  signup_method text not null check (signup_method in ('google', 'email')),
  status text not null default 'pending_verification'
    check (status in ('pending_verification', 'active', 'unsubscribed')),
  source_post_id uuid references public.blog_posts(id) on delete set null,
  source_slug text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_term text,
  utm_content text,
  referrer text,
  verified_at timestamptz,
  unsubscribe_token uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists blog_subscribers_email_key on public.blog_subscribers (lower(email));
create unique index if not exists blog_subscribers_unsub_token_key on public.blog_subscribers (unsubscribe_token);
create index if not exists blog_subscribers_user_idx on public.blog_subscribers (user_id);
create index if not exists blog_subscribers_status_idx on public.blog_subscribers (status);
create index if not exists blog_subscribers_source_post_idx on public.blog_subscribers (source_post_id);

create table if not exists public.blog_subscriber_otps (
  id uuid primary key default gen_random_uuid(),
  subscriber_id uuid not null references public.blog_subscribers(id) on delete cascade,
  code_hash text not null,
  salt text not null,
  expires_at timestamptz not null,
  attempts int not null default 0,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists blog_subscriber_otps_sub_idx on public.blog_subscriber_otps (subscriber_id, created_at desc);

create table if not exists public.blog_email_sends (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.blog_posts(id) on delete cascade,
  subscriber_id uuid not null references public.blog_subscribers(id) on delete cascade,
  token uuid not null default gen_random_uuid(),
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  error text,
  sent_at timestamptz,
  opened_at timestamptz,
  open_count int not null default 0,
  clicked_at timestamptz,
  click_count int not null default 0,
  returned_at timestamptz,
  created_at timestamptz not null default now(),
  unique (post_id, subscriber_id)
);
create unique index if not exists blog_email_sends_token_key on public.blog_email_sends (token);
create index if not exists blog_email_sends_post_idx on public.blog_email_sends (post_id);

create table if not exists public.blog_subscriber_events (
  id uuid primary key default gen_random_uuid(),
  subscriber_id uuid not null references public.blog_subscribers(id) on delete cascade,
  send_id uuid references public.blog_email_sends(id) on delete set null,
  post_id uuid references public.blog_posts(id) on delete set null,
  type text not null check (type in ('signup', 'verified', 'open', 'click', 'return_visit', 'unsubscribe')),
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists blog_subscriber_events_sub_idx on public.blog_subscriber_events (subscriber_id, created_at desc);
create index if not exists blog_subscriber_events_type_idx on public.blog_subscriber_events (type, created_at desc);

create table if not exists public.blog_index_status (
  post_id uuid primary key references public.blog_posts(id) on delete cascade,
  url text not null,
  verdict text,
  coverage_state text,
  indexed boolean not null default false,
  last_crawl_time timestamptz,
  last_inspected_at timestamptz,
  sitemap_submitted_at timestamptz,
  notified_at timestamptz
);

-- RLS: solo lectura para el admin (rol admin). Nada para anon ni para leads. Escriben las Edge Functions (service role).
alter table public.blog_subscribers enable row level security;
alter table public.blog_subscriber_otps enable row level security;
alter table public.blog_email_sends enable row level security;
alter table public.blog_subscriber_events enable row level security;
alter table public.blog_index_status enable row level security;

drop policy if exists "Admin lee suscriptores" on public.blog_subscribers;
create policy "Admin lee suscriptores" on public.blog_subscribers for select to authenticated using (public.is_admin());
drop policy if exists "Admin lee envios" on public.blog_email_sends;
create policy "Admin lee envios" on public.blog_email_sends for select to authenticated using (public.is_admin());
drop policy if exists "Admin lee eventos" on public.blog_subscriber_events;
create policy "Admin lee eventos" on public.blog_subscriber_events for select to authenticated using (public.is_admin());
drop policy if exists "Admin lee indexacion" on public.blog_index_status;
create policy "Admin lee indexacion" on public.blog_index_status for select to authenticated using (public.is_admin());
-- blog_subscriber_otps: sin policies (nadie la lee salvo el service role).

-- ------------------------------------------------------------------------------------------
-- Disparador al publicar: llama a la Edge Function blog-on-publish con pg_net.
-- Secretos en Vault (crear antes de que sirva):
--   select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/blog-on-publish', 'blog_on_publish_url');
--   select vault.create_secret('<mismo valor que BLOG_ON_PUBLISH_SECRET>', 'blog_on_publish_secret');
-- Si faltan o algo falla, solo se emite un warning: publicar un post NUNCA debe fallar por esto.
-- ------------------------------------------------------------------------------------------
create extension if not exists pg_net with schema extensions;

create or replace function public.blog_post_published_notify()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  v_url text;
  v_secret text;
begin
  if NEW.status = 'published' and (TG_OP = 'INSERT' or OLD.status is distinct from 'published') then
    begin
      select decrypted_secret into v_url from vault.decrypted_secrets where name = 'blog_on_publish_url';
      select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'blog_on_publish_secret';
      if v_url is null or v_secret is null then
        raise warning 'blog_post_published_notify: faltan blog_on_publish_url / blog_on_publish_secret en Vault';
      else
        perform net.http_post(
          url := v_url,
          headers := jsonb_build_object('Content-Type', 'application/json', 'x-publish-secret', v_secret),
          body := jsonb_build_object('post_id', NEW.id, 'slug', NEW.slug),
          timeout_milliseconds := 5000
        );
      end if;
    exception when others then
      raise warning 'blog_post_published_notify falló: %', sqlerrm;
    end;
  end if;
  return NEW;
end;
$$;

revoke all on function public.blog_post_published_notify() from public, anon, authenticated;

drop trigger if exists blog_post_published_notify on public.blog_posts;
create trigger blog_post_published_notify
  after insert or update on public.blog_posts
  for each row execute function public.blog_post_published_notify();

-- ------------------------------------------------------------------------------------------
-- Revisión diaria de indexación: 08:00 hora Colombia = 13:00 UTC. Secretos en Vault:
--   select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/blog-index-check', 'blog_index_check_url');
-- (reutiliza blog_on_publish_secret como x-publish-secret)
-- ------------------------------------------------------------------------------------------
create extension if not exists pg_cron with schema pg_catalog;

create or replace function public.blog_disparar_index_check()
returns bigint
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'blog_index_check_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'blog_on_publish_secret';
  if v_url is null or v_secret is null then
    raise warning 'blog_disparar_index_check: faltan blog_index_check_url / blog_on_publish_secret en Vault';
    return null;
  end if;
  return net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-publish-secret', v_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
end;
$$;

revoke all on function public.blog_disparar_index_check() from public, anon, authenticated;

select cron.unschedule(jobname) from cron.job where jobname = 'blog-index-check';
select cron.schedule('blog-index-check', '0 13 * * *', $$select public.blog_disparar_index_check()$$);
