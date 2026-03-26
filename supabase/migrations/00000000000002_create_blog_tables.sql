-- Create blog_categories table
CREATE TABLE IF NOT EXISTS public.blog_categories (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Create blog_posts table
CREATE TABLE IF NOT EXISTS public.blog_posts (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    title TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    excerpt TEXT,
    content TEXT NOT NULL,
    featured_image_url TEXT,
    author_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
    published_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Create junction table for posts and categories (many-to-many)
CREATE TABLE IF NOT EXISTS public.blog_post_categories (
    post_id UUID REFERENCES public.blog_posts(id) ON DELETE CASCADE,
    category_id UUID REFERENCES public.blog_categories(id) ON DELETE CASCADE,
    PRIMARY KEY (post_id, category_id)
);

-- Enable Row Level Security for all blog tables
ALTER TABLE public.blog_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blog_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blog_post_categories ENABLE ROW LEVEL SECURITY;

-- Policies for blog_categories
DROP POLICY IF EXISTS "Anyone can view categories" ON public.blog_categories;
CREATE POLICY "Anyone can view categories" 
    ON public.blog_categories 
    FOR SELECT 
    USING (true);

DROP POLICY IF EXISTS "Admins can manage categories" ON public.blog_categories;
CREATE POLICY "Admins can manage categories" 
    ON public.blog_categories 
    FOR ALL 
    USING (
        auth.uid() IN (
            SELECT id FROM public.profiles 
            WHERE email LIKE '%@admin.soyproceso.com' OR email = 'admin@soyproceso.com'
        )
        OR auth.jwt() ->> 'role' = 'service_role'
    );

-- Policies for blog_posts
DROP POLICY IF EXISTS "Anyone can view published posts" ON public.blog_posts;
CREATE POLICY "Anyone can view published posts" 
    ON public.blog_posts 
    FOR SELECT 
    USING (status = 'published');

DROP POLICY IF EXISTS "Authors can view own posts" ON public.blog_posts;
CREATE POLICY "Authors can view own posts" 
    ON public.blog_posts 
    FOR SELECT 
    USING (auth.uid() = author_id);

DROP POLICY IF EXISTS "Authors can create posts" ON public.blog_posts;
CREATE POLICY "Authors can create posts" 
    ON public.blog_posts 
    FOR INSERT 
    WITH CHECK (auth.uid() = author_id);

DROP POLICY IF EXISTS "Authors can update own posts" ON public.blog_posts;
CREATE POLICY "Authors can update own posts" 
    ON public.blog_posts 
    FOR UPDATE 
    USING (auth.uid() = author_id);

DROP POLICY IF EXISTS "Authors can delete own posts" ON public.blog_posts;
CREATE POLICY "Authors can delete own posts" 
    ON public.blog_posts 
    FOR DELETE 
    USING (auth.uid() = author_id);

DROP POLICY IF EXISTS "Admins can manage all posts" ON public.blog_posts;
CREATE POLICY "Admins can manage all posts" 
    ON public.blog_posts 
    FOR ALL 
    USING (
        auth.uid() IN (
            SELECT id FROM public.profiles 
            WHERE email LIKE '%@admin.soyproceso.com' OR email = 'admin@soyproceso.com'
        )
        OR auth.jwt() ->> 'role' = 'service_role'
    );

-- Policies for blog_post_categories
DROP POLICY IF EXISTS "Anyone can view post categories" ON public.blog_post_categories;
CREATE POLICY "Anyone can view post categories" 
    ON public.blog_post_categories 
    FOR SELECT 
    USING (true);

DROP POLICY IF EXISTS "Admins and authors can manage post categories" ON public.blog_post_categories;
CREATE POLICY "Admins and authors can manage post categories" 
    ON public.blog_post_categories 
    FOR ALL 
    USING (
        EXISTS (
            SELECT 1 FROM public.blog_posts bp
            WHERE bp.id = post_id 
            AND (
                bp.author_id = auth.uid() 
                OR auth.uid() IN (
                    SELECT id FROM public.profiles 
                    WHERE email LIKE '%@admin.soyproceso.com' OR email = 'admin@soyproceso.com'
                )
                OR auth.jwt() ->> 'role' = 'service_role'
            )
        )
    );

-- Create updated_at triggers for all tables
DROP TRIGGER IF EXISTS set_updated_at_categories ON public.blog_categories;
CREATE TRIGGER set_updated_at_categories
    BEFORE UPDATE ON public.blog_categories
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_posts ON public.blog_posts;
CREATE TRIGGER set_updated_at_posts
    BEFORE UPDATE ON public.blog_posts
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();

-- Create function to automatically set published_at
CREATE OR REPLACE FUNCTION public.handle_post_published()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'published' AND OLD.status != 'published' THEN
        NEW.published_at = NOW();
    ELSIF NEW.status != 'published' THEN
        NEW.published_at = NULL;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_published_at ON public.blog_posts;
CREATE TRIGGER set_published_at
    BEFORE UPDATE ON public.blog_posts
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_post_published();

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_blog_posts_slug ON public.blog_posts(slug);
CREATE INDEX IF NOT EXISTS idx_blog_posts_status ON public.blog_posts(status);
CREATE INDEX IF NOT EXISTS idx_blog_posts_published_at ON public.blog_posts(published_at);
CREATE INDEX IF NOT EXISTS idx_blog_posts_author_id ON public.blog_posts(author_id);
CREATE INDEX IF NOT EXISTS idx_blog_posts_created_at ON public.blog_posts(created_at);
CREATE INDEX IF NOT EXISTS idx_blog_categories_slug ON public.blog_categories(slug);

-- Insert default categories
INSERT INTO public.blog_categories (name, slug, description) VALUES
    ('Tecnología', 'tecnologia', 'Artículos sobre tecnología y desarrollo'),
    ('Productividad', 'productividad', 'Consejos y herramientas para mejorar la productividad'),
    ('Desarrollo Personal', 'desarrollo-personal', 'Crecimiento y desarrollo personal'),
    ('Negocios', 'negocios', 'Estrategias y consejos para negocios')
ON CONFLICT (slug) DO NOTHING;