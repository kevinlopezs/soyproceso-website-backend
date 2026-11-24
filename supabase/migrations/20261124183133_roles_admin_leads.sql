-- Roles: UN solo admin posible (soyprocesoc@gmail.com); todos los demás usuarios son "lead".
--
-- Hasta ahora la convención era "cualquier usuario autenticado = admin" (to authenticated using (true))
-- y además las políticas "Authors ..." de blog_posts dejaban a cualquier usuario crear posts propios.
-- Con el registro abierto de Supabase Auth, cualquiera podía crearse una cuenta y escribir/borrar datos.
-- Aquí el permiso pasa a depender de profiles.role = 'admin' (función is_admin()).
-- Los leads (usuarios con rol 'lead') se crean desde las Edge Functions del blog y no heredan ningún permiso.

-- ---------------------------------------------------------------------------------------------
-- 1. profiles: rol y de qué blog viene el lead
-- ---------------------------------------------------------------------------------------------
alter table public.profiles add column if not exists role text not null default 'lead';
alter table public.profiles add column if not exists signup_source text;
alter table public.profiles add column if not exists source_slug text;
alter table public.profiles add column if not exists source_post_id uuid;

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('admin', 'lead'));

-- Solo ese correo puede tener rol admin (imposible a nivel de base de datos para cualquier otro).
alter table public.profiles drop constraint if exists profiles_solo_un_admin;
alter table public.profiles add constraint profiles_solo_un_admin
  check (role <> 'admin' or lower(email) = 'soyprocesoc@gmail.com');

update public.profiles set role = 'admin' where lower(email) = 'soyprocesoc@gmail.com';

create index if not exists profiles_role_idx on public.profiles (role);
create index if not exists profiles_source_slug_idx on public.profiles (source_slug) where source_slug is not null;

-- Un usuario normal (anon/authenticated vía API) no puede cambiar su rol ni su correo de perfil.
create or replace function public.profiles_proteger_campos()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('anon', 'authenticated') then
    if TG_OP = 'INSERT' then
      new.role := 'lead';
    else
      new.role := old.role;
      new.email := old.email;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_proteger_campos on public.profiles;
create trigger profiles_proteger_campos
  before insert or update on public.profiles
  for each row execute function public.profiles_proteger_campos();

-- Todo usuario nuevo nace como 'lead'. Guarda de qué blog viene si el alta lo informa en su metadata.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_post uuid;
begin
  begin
    v_post := nullif(meta ->> 'source_post_id', '')::uuid;
  exception when others then
    v_post := null;
  end;

  insert into public.profiles (id, email, full_name, avatar_url, role, signup_source, source_slug, source_post_id, created_at, updated_at)
  values (
    new.id, new.email, coalesce(meta ->> 'full_name', ''), meta ->> 'avatar_url', 'lead',
    meta ->> 'signup_source', meta ->> 'source_slug', v_post, now(), now()
  );
  return new;
exception
  when unique_violation then
    return new;
  when others then
    -- Nunca bloquear la creación del usuario en auth.users.
    return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 2. is_admin()
-- ---------------------------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin');
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated, service_role;

drop policy if exists "Admin lee perfiles" on public.profiles;
create policy "Admin lee perfiles" on public.profiles for select to authenticated using (public.is_admin());

-- ---------------------------------------------------------------------------------------------
-- 3. Políticas: de "cualquier autenticado" / "autor" a solo admin
-- ---------------------------------------------------------------------------------------------
-- Blog
drop policy if exists "Admins can manage categories" on public.blog_categories;
create policy "Admins can manage categories" on public.blog_categories for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Admins and authors can manage post categories" on public.blog_post_categories;
create policy "Admins can manage post categories" on public.blog_post_categories for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Admins can manage all posts" on public.blog_posts;
drop policy if exists "Authors can create posts" on public.blog_posts;
drop policy if exists "Authors can delete own posts" on public.blog_posts;
drop policy if exists "Authors can update own posts" on public.blog_posts;
drop policy if exists "Authors can view own posts" on public.blog_posts;
create policy "Admins can manage all posts" on public.blog_posts for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Archivos subidos
drop policy if exists "Admins can view all uploads" on public.uploaded_files;
drop policy if exists "Users can upload files" on public.uploaded_files;
drop policy if exists "Users can view own uploads" on public.uploaded_files;
create policy "Admins can manage uploads" on public.uploaded_files for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Informes de clientes y feedback
drop policy if exists "Authenticated users manage client_reports" on public.client_reports;
create policy "Admins manage client_reports" on public.client_reports for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Authenticated users manage feedback_answers" on public.feedback_answers;
create policy "Admins manage feedback_answers" on public.feedback_answers for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Authenticated users manage feedback_questions" on public.feedback_questions;
create policy "Admins manage feedback_questions" on public.feedback_questions for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Authenticated users manage feedback_responses" on public.feedback_responses;
create policy "Admins manage feedback_responses" on public.feedback_responses for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Cotizador
drop policy if exists "Authenticated users read cotizador_leads" on public.cotizador_leads;
drop policy if exists "Authenticated users update cotizador_leads" on public.cotizador_leads;
create policy "Admins read cotizador_leads" on public.cotizador_leads for select to authenticated using (public.is_admin());
create policy "Admins update cotizador_leads" on public.cotizador_leads for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- cotizador_bloqueos vive en otra rama: solo se toca si la tabla existe.
do $$
begin
  if to_regclass('public.cotizador_bloqueos') is not null then
    drop policy if exists "Authenticated users read cotizador_bloqueos" on public.cotizador_bloqueos;
    drop policy if exists "Authenticated users insert cotizador_bloqueos" on public.cotizador_bloqueos;
    drop policy if exists "Authenticated users delete cotizador_bloqueos" on public.cotizador_bloqueos;
    create policy "Admins manage cotizador_bloqueos" on public.cotizador_bloqueos for all to authenticated
      using (public.is_admin()) with check (public.is_admin());
  end if;
end $$;

-- Licitaciones SECOP
drop policy if exists "equipo lee cronograma" on public.secop_cronograma;
create policy "Admins leen cronograma" on public.secop_cronograma for select to authenticated using (public.is_admin());
drop policy if exists "equipo lee documentos" on public.secop_documentos;
create policy "Admins leen documentos" on public.secop_documentos for select to authenticated using (public.is_admin());
drop policy if exists "equipo lee eventos" on public.secop_eventos;
create policy "Admins leen eventos" on public.secop_eventos for select to authenticated using (public.is_admin());
drop policy if exists "equipo marca eventos leidos" on public.secop_eventos;
create policy "Admins marcan eventos leidos" on public.secop_eventos for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists "equipo lee procesos" on public.secop_procesos;
create policy "Admins leen procesos" on public.secop_procesos for select to authenticated using (public.is_admin());
drop policy if exists "equipo actualiza seguimiento" on public.secop_procesos;
create policy "Admins actualizan seguimiento" on public.secop_procesos for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists "equipo lee corridas" on public.secop_sync_runs;
create policy "Admins leen corridas" on public.secop_sync_runs for select to authenticated using (public.is_admin());

-- WhatsApp
drop policy if exists "Admins can view all chats" on public.wa_chats;
create policy "Admins can view all chats" on public.wa_chats for select to authenticated using (public.is_admin());
drop policy if exists "Admins can update chats" on public.wa_chats;
create policy "Admins can update chats" on public.wa_chats for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists "Admins can view all messages" on public.wa_messages;
create policy "Admins can view all messages" on public.wa_messages for select to authenticated using (public.is_admin());
drop policy if exists "Admins can insert messages" on public.wa_messages;
create policy "Admins can insert messages" on public.wa_messages for insert to authenticated with check (public.is_admin());

-- Storage: documentos de SECOP
drop policy if exists "equipo descarga documentos secop" on storage.objects;
create policy "equipo descarga documentos secop" on storage.objects for select to authenticated
  using (bucket_id = 'secop-documentos' and public.is_admin());

-- ---------------------------------------------------------------------------------------------
-- 4. Funciones SECURITY DEFINER expuestas por la API
-- ---------------------------------------------------------------------------------------------
-- secop_guardar_ficha la llama el panel de admin: ahora exige rol admin (antes: cualquier autenticado).
do $$
declare
  v_def text;
begin
  select pg_get_functiondef('public.secop_guardar_ficha(jsonb)'::regprocedure) into v_def;
  if v_def like '%if auth.uid() is null then%' then
    execute replace(v_def, 'if auth.uid() is null then', 'if not public.is_admin() then');
  end if;
end $$;

-- Sin uso desde el sitio ni desde las funciones: solo el service role las necesita.
revoke all on function public.record_file_upload(text, text, text, bigint, text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.generate_bunny_upload_path(uuid, text, text) from public, anon, authenticated;
