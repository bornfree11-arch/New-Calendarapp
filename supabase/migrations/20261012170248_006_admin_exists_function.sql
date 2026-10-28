-- Creates a SECURITY DEFINER function that checks if an admin profile exists.
-- This is callable by unauthenticated users (anon role) so the frontend can
-- determine whether to show the onboarding setup screen or the login screen.
-- RLS on profiles blocks anon reads, so without this the count always returns 0
-- for unauthenticated requests, causing the setup screen to appear even when
-- an admin already exists.

CREATE OR REPLACE FUNCTION admin_exists()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (SELECT 1 FROM profiles WHERE role = 'admin' LIMIT 1);
END;
$$;

GRANT EXECUTE ON FUNCTION admin_exists() TO anon, authenticated;