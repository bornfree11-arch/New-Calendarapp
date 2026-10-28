/*
# Fix: Inactive user trigger and admin profile management

## Overview
1. Fixes the `check_user_active` trigger which used `NEW.id` (session UUID)
   instead of `NEW.user_id` — the original would never find a profile row
   and would silently allow deactivated users to log in.
2. Adds a separate UPDATE policy `profiles_update_admin` so admin users can
   edit any profile (role, color, status, etc). The existing `profiles_update_own`
   only allows users to update their own row, which blocked admins from
   managing other users via the User Management screen.

## Security Changes
- RLS: new `profiles_update_admin` policy (UPDATE, TO authenticated,
  USING + WITH CHECK that the requesting user is an admin).
- Trigger: `check_user_active` corrected to look up `NEW.user_id`.
*/

-- ============================================================================
-- Fix: check_user_active trigger
-- ============================================================================
CREATE OR REPLACE FUNCTION check_user_active()
RETURNS trigger AS $$
DECLARE
  user_status text;
BEGIN
  SELECT status INTO user_status FROM profiles WHERE id = NEW.user_id;
  IF user_status = 'inactive' THEN
    RAISE EXCEPTION 'Your account has been deactivated. Please contact your administrator.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- RLS: Allow admins to update any profile
-- ============================================================================
DROP POLICY IF EXISTS "profiles_update_admin" ON profiles;
CREATE POLICY "profiles_update_admin"
  ON profiles FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid() AND p.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid() AND p.role = 'admin'
    )
  );