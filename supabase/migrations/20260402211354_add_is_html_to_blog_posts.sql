-- Add is_html boolean column to blog_posts table
ALTER TABLE public.blog_posts 
ADD COLUMN IF NOT EXISTS is_html BOOLEAN DEFAULT FALSE NOT NULL;

-- Update existing records to false (already default, but just in case)
UPDATE public.blog_posts SET is_html = FALSE WHERE is_html IS NULL;
