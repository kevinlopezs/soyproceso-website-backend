-- The survey questions themselves are not sensitive (just configuration text),
-- and the client landing page needs to render them to build the feedback
-- stepper. Only active questions are exposed; responses/answers stay locked
-- behind the admin-only policies and the submit_feedback() RPC.
create policy "Public can read active feedback_questions"
  on public.feedback_questions
  for select
  to anon, authenticated
  using (is_active = true);
