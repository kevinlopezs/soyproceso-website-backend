-- Migration for Autodiagnostico submissions

CREATE TABLE IF NOT EXISTS public.autodiagnostico_submissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ip_address TEXT,
    user_agent TEXT,
    utm_source TEXT,
    utm_medium TEXT,
    utm_campaign TEXT,
    utm_term TEXT,
    utm_content TEXT,
    email TEXT,
    answers JSONB DEFAULT '{}'::jsonb,
    score_data JSONB DEFAULT '{}'::jsonb,
    pdf_generated BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS
ALTER TABLE public.autodiagnostico_submissions ENABLE ROW LEVEL SECURITY;

-- Policy: Only service role can read, insert can be done by service role (edge functions)
-- Since Edge Functions run with service_role by default if configured to, or we can allow anon insert.
-- We'll allow public insert so that clients could also theoretically insert, but passing through Edge Function is better.
CREATE POLICY "Public can insert autodiagnostico submissions" 
ON public.autodiagnostico_submissions 
FOR INSERT 
WITH CHECK (true);

CREATE POLICY "Service role can update autodiagnostico submissions" 
ON public.autodiagnostico_submissions 
FOR UPDATE 
USING (true);

-- No SELECT policy for public, so anon cannot read data.
