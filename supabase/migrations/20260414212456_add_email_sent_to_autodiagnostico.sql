ALTER TABLE public.autodiagnostico_submissions ADD COLUMN email_sent boolean DEFAULT false;
ALTER TABLE public.autodiagnostico_submissions ADD COLUMN pdf_url text;

CREATE POLICY "Allow public read submissions" ON public.autodiagnostico_submissions FOR SELECT USING (true);
CREATE POLICY "Allow public update pdf fields" ON public.autodiagnostico_submissions FOR UPDATE USING (true);
