-- Create email_unsubscriptions table
CREATE TABLE IF NOT EXISTS public.email_unsubscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL,
    list_id TEXT,
    resubscribe_url TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.email_unsubscriptions ENABLE ROW LEVEL SECURITY;

-- Allow anonymous inserts (from the frontend)
CREATE POLICY "Allow anonymous inserts" ON public.email_unsubscriptions 
FOR INSERT WITH CHECK (true);

-- Add comments for documentation
COMMENT ON TABLE public.email_unsubscriptions IS 'Logs of users who have unsubscribed from email marketing lists via Sendy.';
COMMENT ON COLUMN public.email_unsubscriptions.email IS 'The email address of the unsubscribed user.';
COMMENT ON COLUMN public.email_unsubscriptions.list_id IS 'The Sendy list ID from which the user unsubscribed.';
COMMENT ON COLUMN public.email_unsubscriptions.resubscribe_url IS 'The unique Sendy URL to re-subscribe the user.';
