-- Se retira el registro de eventos de Amazon SES en Supabase (7 oct 2026).
-- La campaña de 40.000+ correos generó cientos de miles de llamadas a la edge function
-- ses-events y tumbó la base. Rebotes y quejas los sigue gestionando Sendy por sus propios
-- temas SNS (bounces / complaints); envíos y entregas no aportaban información útil.
drop table if exists public.ses_events;
