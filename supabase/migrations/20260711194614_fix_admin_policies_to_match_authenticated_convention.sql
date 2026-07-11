-- Bug fix: the "Admins manage X" policies on client_reports/feedback_* checked
-- for a profiles.email matching '%@admin.soyproceso.com' or 'admin@soyproceso.com'.
-- That pattern was copied from blog_posts, but blog_posts writes actually flow
-- through its separate "author owns the row" policies (author_id = auth.uid()),
-- not through that email-pattern policy. The real admin account uses a plain
-- gmail address, so the copied policy silently blocked every insert here.
-- This app has a single admin account and already treats "any authenticated
-- session" as admin elsewhere (see wa_chats/wa_messages policies) — align
-- these new tables with that same, actually-working convention.

drop policy if exists "Admins manage client_reports" on public.client_reports;
create policy "Authenticated users manage client_reports"
  on public.client_reports for all
  to authenticated
  using (true)
  with check (true);

drop policy if exists "Admins manage feedback_questions" on public.feedback_questions;
create policy "Authenticated users manage feedback_questions"
  on public.feedback_questions for all
  to authenticated
  using (true)
  with check (true);

drop policy if exists "Admins manage feedback_responses" on public.feedback_responses;
create policy "Authenticated users manage feedback_responses"
  on public.feedback_responses for all
  to authenticated
  using (true)
  with check (true);

drop policy if exists "Admins manage feedback_answers" on public.feedback_answers;
create policy "Authenticated users manage feedback_answers"
  on public.feedback_answers for all
  to authenticated
  using (true)
  with check (true);
