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

-- Insertar campaña inicial
INSERT INTO public.experience_campaigns (slug, title, audio_url, whatsapp_url, questions)
VALUES (
    'experiencia-soyproceso-2026-1',
    'Soy Proceso 2026 - Experiencia de Vela',
    'https://soyproceso.b-cdn.net/experiencia-soyproceso-2026-1/audio-meditacion.mp3',
    'https://wa.me/something',
    '[
        {
            "id": "q1",
            "title": "¿Qué sentiste cuando encendiste la vela?",
            "subtitle": "No hay respuesta correcta — solo la tuya.",
            "options": [
                {"id": "calma", "label": "Calma y presencia", "desc": "El ambiente cambió...", "icon": "🌊"},
                {"id": "curiosidad", "label": "Curiosidad y apertura", "desc": "Me pregunté qué iba a pasar...", "icon": "✨"},
                {"id": "emocion", "label": "Emoción inesperada", "desc": "Algo se movió por dentro...", "icon": "💛"},
                {"id": "gratitud", "label": "Gratitud y calor", "desc": "Sentí que alguien pensó en mí...", "icon": "🌿"},
                {"id": "no_encendida", "label": "Todavía no la he encendido", "desc": "Estoy esperando el momento ideal", "icon": "🕯️"}
            ]
        },
        {
            "id": "q2",
            "title": "¿En qué momento de tu vida está tu vela?",
            "subtitle": "Ella llegó en el momento justo — ¿cuál es ese momento para ti?",
            "options": [
                {"id": "nuevo", "label": "Estoy comenzando algo nuevo", "desc": "Un camino, una decisión, una etapa diferente", "icon": "🌱"},
                {"id": "pausa", "label": "Necesito hacer una pausa", "desc": "Llevo mucho tiempo dándome a todo menos a mí", "icon": "🌊"},
                {"id": "proceso", "label": "Estoy en medio de un proceso", "desc": "Transformándome aunque no siempre lo sienta", "icon": "🔥"},
                {"id": "ciclo", "label": "Estoy cerrando un ciclo", "desc": "Soltando para abrir espacio a lo que viene", "icon": "🍂"}
            ]
        },
        {
            "id": "q3",
            "title": "¿Para quién fue esta vela?",
            "subtitle": "Ayúdanos a entender quién acompaña estos momentos.",
            "options": [
                {"id": "mi", "label": "Para mí", "desc": "Me la regalé yo misma o la compré para mi espacio", "icon": "🪞"},
                {"id": "regalo", "label": "Me la regalaron", "desc": "Alguien pensó en mí y me la trajo", "icon": "🎁"},
                {"id": "terapeutico", "label": "La recibí en un espacio terapéutico", "desc": "Yoga, meditación, consulta psicológica u holística", "icon": "🌿"}
            ]
        }
    ]'::jsonb
) ON CONFLICT (slug) DO UPDATE SET 
    questions = EXCLUDED.questions,
    audio_url = EXCLUDED.audio_url,
    whatsapp_url = EXCLUDED.whatsapp_url;
