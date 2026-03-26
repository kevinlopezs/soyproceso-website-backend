-- Drop the existing trigger to be safe and recreate it
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- Make the handle_new_user function extremely robust
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER 
SECURITY DEFINER 
SET search_path = public 
AS $$
DECLARE
    extracted_name TEXT;
BEGIN
    -- Try to safely extract full_name, defaulting to empty string if not possible
    BEGIN
        IF NEW.raw_user_meta_data IS NOT NULL THEN
            extracted_name := NEW.raw_user_meta_data->>'full_name';
        END IF;
    EXCEPTION WHEN OTHERS THEN
        extracted_name := '';
    END;

    INSERT INTO public.profiles (id, email, full_name, created_at, updated_at)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(extracted_name, ''),
        NOW(),
        NOW()
    );
    RETURN NEW;
EXCEPTION
    WHEN unique_violation THEN
        -- If for some reason the profile already exists, just return
        RETURN NEW;
    WHEN OTHERS THEN
        -- Even if it fails for another reason, do not block the user creation in auth.users
        -- The user won't have a profile, which might need to be created later, but auth will pass
        RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Set correct owner so security definer runs as postgres
ALTER FUNCTION public.handle_new_user() OWNER TO postgres;

-- Recreate trigger
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user();
