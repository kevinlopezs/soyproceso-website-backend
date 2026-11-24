-- Marca cuándo se envió el correo de bienvenida a cada suscriptor (se envía una sola vez).
alter table public.blog_subscribers add column if not exists welcome_sent_at timestamptz;
