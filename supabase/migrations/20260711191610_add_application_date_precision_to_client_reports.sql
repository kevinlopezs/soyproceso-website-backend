-- Some companies only know the month/year the battery was applied (not the exact day).
-- This lets the UI render "Julio 2026" instead of fabricating a specific day.
alter table public.client_reports
  add column if not exists application_date_precision text not null default 'day'
  check (application_date_precision in ('day', 'month'));
