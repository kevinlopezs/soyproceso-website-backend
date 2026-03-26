-- Create table to track uploaded files
CREATE TABLE IF NOT EXISTS public.uploaded_files (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    filename TEXT NOT NULL,
    path TEXT NOT NULL,
    url TEXT NOT NULL,
    file_size BIGINT,
    mime_type TEXT,
    uploaded_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb
);

-- Enable RLS for uploaded_files
ALTER TABLE public.uploaded_files ENABLE ROW LEVEL SECURITY;

-- Policies for uploaded_files
DROP POLICY IF EXISTS "Users can view own uploads" ON public.uploaded_files;
CREATE POLICY "Users can view own uploads" 
    ON public.uploaded_files 
    FOR SELECT 
    USING (auth.uid() = uploaded_by);

DROP POLICY IF EXISTS "Users can upload files" ON public.uploaded_files;
CREATE POLICY "Users can upload files" 
    ON public.uploaded_files 
    FOR INSERT 
    WITH CHECK (auth.uid() = uploaded_by);

DROP POLICY IF EXISTS "Admins can view all uploads" ON public.uploaded_files;
CREATE POLICY "Admins can view all uploads" 
    ON public.uploaded_files 
    FOR SELECT 
    USING (
        auth.uid() IN (
            SELECT id FROM public.profiles 
            WHERE email LIKE '%@admin.soyproceso.com' OR email = 'admin@soyproceso.com'
        )
        OR auth.jwt() ->> 'role' = 'service_role'
    );

-- Functions
CREATE OR REPLACE FUNCTION public.generate_bunny_upload_path(
    user_id UUID,
    filename TEXT,
    folder TEXT DEFAULT 'blog-images'
)
RETURNS TEXT AS $$
DECLARE
    file_ext TEXT;
    clean_filename TEXT;
    unique_path TEXT;
BEGIN
    file_ext := LOWER(SUBSTRING(filename FROM '\.([^\.]+)$'));
    clean_filename := REGEXP_REPLACE(LOWER(SUBSTRING(filename FROM '^([^\.]+)')), '[^a-z0-9_-]', '-', 'g');
    unique_path := folder || '/' || user_id || '/' || EXTRACT(EPOCH FROM NOW())::INT || '-' || MD5(RANDOM()::TEXT || NOW()::TEXT) || '-' || clean_filename || '.' || COALESCE(file_ext, 'jpg');
    RETURN unique_path;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.record_file_upload(
    p_filename TEXT,
    p_path TEXT,
    p_url TEXT,
    p_file_size BIGINT,
    p_mime_type TEXT,
    p_uploaded_by UUID,
    p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID AS $$
DECLARE
    new_id UUID;
BEGIN
    INSERT INTO public.uploaded_files (filename, path, url, file_size, mime_type, uploaded_by, metadata) 
    VALUES (p_filename, p_path, p_url, p_file_size, p_mime_type, p_uploaded_by, p_metadata) 
    RETURNING id INTO new_id;
    RETURN new_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_uploaded_files_uploaded_by ON public.uploaded_files(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_uploaded_files_uploaded_at ON public.uploaded_files(uploaded_at);

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION public.generate_bunny_upload_path TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_file_upload TO authenticated;