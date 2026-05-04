-- Migration to create Email Marketing Campaign Analytics tables

-- Table: email_campaigns
CREATE TABLE IF NOT EXISTS public.email_campaigns (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,
    campaign_date DATE NOT NULL,
    source_list TEXT,
    total_sent INTEGER DEFAULT 0,
    total_unopened INTEGER DEFAULT 0,
    total_unsubscribed INTEGER DEFAULT 0,
    total_clicked INTEGER DEFAULT 0,
    bunny_all_url TEXT,
    bunny_unopened_url TEXT,
    bunny_unsubscribed_url TEXT,
    bunny_clicked_url TEXT,
    created_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- RLS for email_campaigns
ALTER TABLE public.email_campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated users to read campaigns" 
ON public.email_campaigns FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow authenticated users to insert campaigns" 
ON public.email_campaigns FOR INSERT TO authenticated WITH CHECK (true);


-- Table: email_campaign_contacts
CREATE TABLE IF NOT EXISTS public.email_campaign_contacts (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    campaign_id UUID REFERENCES public.email_campaigns(id) ON DELETE CASCADE,
    name TEXT,
    email TEXT NOT NULL,
    type TEXT NOT NULL, -- 'all', 'unopened', 'unsubscribed', 'clicked', 'attribution'
    clicks INTEGER DEFAULT 0,
    list_name TEXT,
    country TEXT,
    last_activity TIMESTAMP WITH TIME ZONE,
    status TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- RLS for email_campaign_contacts
ALTER TABLE public.email_campaign_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated users to read campaign contacts" 
ON public.email_campaign_contacts FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow authenticated users to insert campaign contacts" 
ON public.email_campaign_contacts FOR INSERT TO authenticated WITH CHECK (true);

-- Index for fast queries
CREATE INDEX idx_email_campaign_contacts_campaign_id ON public.email_campaign_contacts(campaign_id);
CREATE INDEX idx_email_campaign_contacts_email ON public.email_campaign_contacts(email);
CREATE INDEX idx_email_campaign_contacts_type ON public.email_campaign_contacts(type);


-- Table: email_campaign_link_uploads
CREATE TABLE IF NOT EXISTS public.email_campaign_link_uploads (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    campaign_id UUID REFERENCES public.email_campaigns(id) ON DELETE CASCADE,
    url_label TEXT NOT NULL,
    bunny_url TEXT,
    total_clickers INTEGER DEFAULT 0,
    uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- RLS for email_campaign_link_uploads
ALTER TABLE public.email_campaign_link_uploads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated users to read link uploads" 
ON public.email_campaign_link_uploads FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow authenticated users to insert link uploads" 
ON public.email_campaign_link_uploads FOR INSERT TO authenticated WITH CHECK (true);


-- Table: email_leads (CRM Pipeline)
CREATE TABLE IF NOT EXISTS public.email_leads (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    campaign_id UUID REFERENCES public.email_campaigns(id) ON DELETE CASCADE,
    contact_email TEXT NOT NULL,
    contact_name TEXT,
    attribution_source TEXT,
    stage TEXT NOT NULL DEFAULT 'nuevo', -- nuevo, contactado, cotizacion, negociacion, ganado, perdido
    notes TEXT,
    assigned_to TEXT,
    next_action_date DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Function to auto-update updated_at
CREATE OR REPLACE FUNCTION update_modified_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_email_leads_modtime
BEFORE UPDATE ON public.email_leads
FOR EACH ROW
EXECUTE FUNCTION update_modified_column();

-- RLS for email_leads
ALTER TABLE public.email_leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated users to read email leads" 
ON public.email_leads FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow authenticated users to manage email leads" 
ON public.email_leads FOR ALL TO authenticated USING (true) WITH CHECK (true);
