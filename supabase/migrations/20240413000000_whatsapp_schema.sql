-- Create WhatsApp Chats table
CREATE TABLE IF NOT EXISTS public.wa_chats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    whatsapp_id TEXT UNIQUE NOT NULL, -- The user's WhatsApp ID (usually phone number)
    phone_number TEXT NOT NULL,
    display_name TEXT,
    last_message TEXT,
    last_message_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Create WhatsApp Messages table
CREATE TABLE IF NOT EXISTS public.wa_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chat_id UUID NOT NULL REFERENCES public.wa_chats(id) ON DELETE CASCADE,
    whatsapp_message_id TEXT UNIQUE, -- ID from WhatsApp Graph API
    type TEXT DEFAULT 'text', -- text, image, document, etc.
    body TEXT,
    from_me BOOLEAN DEFAULT FALSE, -- TRUE if sent from dashboard, FALSE if incoming
    status TEXT DEFAULT 'received', -- received, sent, delivered, read
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Enable Row Level Security
ALTER TABLE public.wa_chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wa_messages ENABLE ROW LEVEL SECURITY;

-- RLS Policies for wa_chats
CREATE POLICY "Admins can view all chats" 
    ON public.wa_chats 
    FOR SELECT 
    TO authenticated 
    USING (TRUE);

CREATE POLICY "Admins can update chats" 
    ON public.wa_chats 
    FOR UPDATE 
    TO authenticated 
    USING (TRUE);

CREATE POLICY "Service role can do anything with chats" 
    ON public.wa_chats 
    FOR ALL 
    TO service_role 
    USING (TRUE);

-- RLS Policies for wa_messages
CREATE POLICY "Admins can view all messages" 
    ON public.wa_messages 
    FOR SELECT 
    TO authenticated 
    USING (TRUE);

CREATE POLICY "Admins can insert messages" 
    ON public.wa_messages 
    FOR INSERT 
    TO authenticated 
    WITH CHECK (TRUE);

CREATE POLICY "Service role can do anything with messages" 
    ON public.wa_messages 
    FOR ALL 
    TO service_role 
    USING (TRUE);

-- Trigger for updated_at on wa_chats
DROP TRIGGER IF EXISTS set_updated_at_wa_chats ON public.wa_chats;
CREATE TRIGGER set_updated_at_wa_chats
    BEFORE UPDATE ON public.wa_chats
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();

-- Add tables to realtime publication
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.wa_chats;
        ALTER PUBLICATION supabase_realtime ADD TABLE public.wa_messages;
    ELSE
        CREATE PUBLICATION supabase_realtime FOR TABLE public.wa_chats, public.wa_messages;
    END IF;
EXCEPTION
    WHEN others THEN
        RAISE NOTICE 'Could not add tables to publication: %', SQLERRM;
END $$;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_wa_chats_whatsapp_id ON public.wa_chats(whatsapp_id);
CREATE INDEX IF NOT EXISTS idx_wa_messages_chat_id ON public.wa_messages(chat_id);
CREATE INDEX IF NOT EXISTS idx_wa_messages_created_at ON public.wa_messages(created_at);
