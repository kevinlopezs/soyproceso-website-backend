-- Revierte 20261124183133_roles_admin_leads.sql (vuelve a "cualquier autenticado = admin").
-- Úsalo solo en una emergencia: reabre el acceso de cualquier usuario registrado.
drop policy if exists "Admin lee perfiles" on public.profiles;

drop policy if exists "Admins can manage categories" on public.blog_categories;
create policy "Admins can manage categories" on public.blog_categories for all to authenticated using (true) with check (true);
drop policy if exists "Admins can manage post categories" on public.blog_post_categories;
create policy "Admins and authors can manage post categories" on public.blog_post_categories for all to authenticated using (true) with check (true);
drop policy if exists "Admins can manage all posts" on public.blog_posts;
create policy "Admins can manage all posts" on public.blog_posts for all to authenticated using (true) with check (true);
drop policy if exists "Admins can manage uploads" on public.uploaded_files;
create policy "Admins can view all uploads" on public.uploaded_files for select to authenticated using (true);
create policy "Users can upload files" on public.uploaded_files for insert to authenticated with check (auth.uid() = uploaded_by);

drop policy if exists "Admins manage client_reports" on public.client_reports;
create policy "Authenticated users manage client_reports" on public.client_reports for all to authenticated using (true) with check (true);
drop policy if exists "Admins manage feedback_answers" on public.feedback_answers;
create policy "Authenticated users manage feedback_answers" on public.feedback_answers for all to authenticated using (true) with check (true);
drop policy if exists "Admins manage feedback_questions" on public.feedback_questions;
create policy "Authenticated users manage feedback_questions" on public.feedback_questions for all to authenticated using (true) with check (true);
drop policy if exists "Admins manage feedback_responses" on public.feedback_responses;
create policy "Authenticated users manage feedback_responses" on public.feedback_responses for all to authenticated using (true) with check (true);

drop policy if exists "Admins read cotizador_leads" on public.cotizador_leads;
drop policy if exists "Admins update cotizador_leads" on public.cotizador_leads;
create policy "Authenticated users read cotizador_leads" on public.cotizador_leads for select to authenticated using (true);
create policy "Authenticated users update cotizador_leads" on public.cotizador_leads for update to authenticated using (true) with check (true);
drop policy if exists "Admins manage cotizador_bloqueos" on public.cotizador_bloqueos;
create policy "Authenticated users read cotizador_bloqueos" on public.cotizador_bloqueos for select to authenticated using (true);
create policy "Authenticated users insert cotizador_bloqueos" on public.cotizador_bloqueos for insert to authenticated with check (true);
create policy "Authenticated users delete cotizador_bloqueos" on public.cotizador_bloqueos for delete to authenticated using (true);

drop policy if exists "Admins leen cronograma" on public.secop_cronograma;
create policy "equipo lee cronograma" on public.secop_cronograma for select to authenticated using (true);
drop policy if exists "Admins leen documentos" on public.secop_documentos;
create policy "equipo lee documentos" on public.secop_documentos for select to authenticated using (true);
drop policy if exists "Admins leen eventos" on public.secop_eventos;
create policy "equipo lee eventos" on public.secop_eventos for select to authenticated using (true);
drop policy if exists "Admins marcan eventos leidos" on public.secop_eventos;
create policy "equipo marca eventos leidos" on public.secop_eventos for update to authenticated using (true) with check (true);
drop policy if exists "Admins leen procesos" on public.secop_procesos;
create policy "equipo lee procesos" on public.secop_procesos for select to authenticated using (true);
drop policy if exists "Admins actualizan seguimiento" on public.secop_procesos;
create policy "equipo actualiza seguimiento" on public.secop_procesos for update to authenticated using (true) with check (true);
drop policy if exists "Admins leen corridas" on public.secop_sync_runs;
create policy "equipo lee corridas" on public.secop_sync_runs for select to authenticated using (true);

drop policy if exists "Admins can view all chats" on public.wa_chats;
create policy "Admins can view all chats" on public.wa_chats for select to authenticated using (true);
drop policy if exists "Admins can update chats" on public.wa_chats;
create policy "Admins can update chats" on public.wa_chats for update to authenticated using (true);
drop policy if exists "Admins can view all messages" on public.wa_messages;
create policy "Admins can view all messages" on public.wa_messages for select to authenticated using (true);
drop policy if exists "Admins can insert messages" on public.wa_messages;
create policy "Admins can insert messages" on public.wa_messages for insert to authenticated with check (true);
drop policy if exists "equipo descarga documentos secop" on storage.objects;
create policy "equipo descarga documentos secop" on storage.objects for select to authenticated using (bucket_id = 'secop-documentos');

do $$
declare v_def text;
begin
  select pg_get_functiondef('public.secop_guardar_ficha(jsonb)'::regprocedure) into v_def;
  execute replace(v_def, 'if not public.is_admin() then', 'if auth.uid() is null then');
end $$;
grant execute on function public.record_file_upload(text, text, text, bigint, text, uuid, jsonb) to anon, authenticated;
grant execute on function public.generate_bunny_upload_path(uuid, text, text) to anon, authenticated;
-- Las columnas/roles de profiles y is_admin() se pueden dejar: no abren acceso por sí solas.
