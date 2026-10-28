/*
# Fix: handle_new_user trigger and profile creation flow

## Problem
The `handle_new_user()` SECURITY DEFINER trigger function lacked a `SET search_path`,
which can cause it to fail on some Supabase configurations. When it fails, the entire
auth.users INSERT is rolled back, producing "Database error saving new user."

Additionally, the frontend SetupScreen was doing a separate INSERT into profiles
after signUp, which would conflict with the trigger-created row (duplicate primary key).

## Changes
1. Replaces `handle_new_user()` with a version that has `SET search_path = public`
   and uses `ON CONFLICT DO NOTHING` so it never fails if a profile already exists.
2. The trigger still auto-creates a minimal profile row (id, email, full_name from
   user metadata) so that RLS doesn't break if the frontend insert is slow/fails.
3. The frontend will switch to upsert to update the trigger-created row with full
   admin data (role, phone, color, etc.) instead of trying a fresh insert.

## Security
- No RLS policy changes.
- Function search_path is now explicitly set to 'public' (security best practice).
*/

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', ''))
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();