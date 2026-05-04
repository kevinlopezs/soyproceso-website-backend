-- 00000000000006_create_experience_tables.sql

-- Tabla para almacenar diferentes campañas/experiencias de marketing
CREATE TABLE IF NOT EXISTS public.experience_campaigns (
    slug TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    questions JSONB NOT NULL,
    audio_url TEXT,
    whatsapp_url TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Tabla para almacenar las respuestas de los usuarios (anonimas)
CREATE TABLE IF NOT EXISTS public.experience_submissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_slug TEXT REFERENCES public.experience_campaigns(slug) ON DELETE CASCADE,
    ip_address TEXT,
    user_agent TEXT,
    q1_answer TEXT,
    q2_answer TEXT,
    q3_answer TEXT,
    photo_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Habilitar RLS (Row Level Security)
ALTER TABLE public.experience_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.experience_submissions ENABLE ROW LEVEL SECURITY;

-- Políticas: cualquiera puede leer campañas activas
CREATE POLICY "Public can read active campaigns" 
ON public.experience_campaigns 
FOR SELECT 
USING (is_active = true);

-- Políticas: cualquiera puede insertar respuestas (anonimo)
-- Pero solo nosotros (service_role) podemos ver las respuestas completas
CREATE POLICY "Public can insert submissions" 
ON public.experience_submissions 
FOR INSERT 
WITH CHECK (true);


