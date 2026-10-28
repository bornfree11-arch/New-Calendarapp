/*
# Set up pg_cron to poll the send-reminder Edge Function

## Purpose
The send-reminder Edge Function processes pending reminder rows when invoked via POST.
This migration creates a secure config table for the auth key, a helper function in the
public schema, and schedules a recurring pg_cron job every 2 minutes that POSTs to the
Edge Function URL with an Authorization header so the Supabase routing gateway accepts
the request.

## Changes
1. Create `cron_config` table to store the auth key securely (RLS locked, no policies).
2. Insert the anon key (edge function has verify_jwt=false).
3. Create a SECURITY DEFINER helper function `public.poll_send_reminder()` that issues
   an authenticated POST to the Edge Function endpoint using http_post.
4. Register a pg_cron job named 'poll-send-reminder' on a 2-minute schedule.

## Security
- The function is SECURITY DEFINER so the cron job can execute it.
- The cron_config table has RLS enabled with no policies — only superuser and
  SECURITY DEFINER functions can read it.
- The Edge Function has verify_jwt=false, so the anon key is sufficient.
*/

-- 1. Create a secure config table for cron credentials
CREATE TABLE IF NOT EXISTS cron_config (
  id int PRIMARY KEY DEFAULT 1,
  key_name text NOT NULL,
  key_value text NOT NULL,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT single_row CHECK (id = 1)
);

ALTER TABLE cron_config ENABLE ROW LEVEL SECURITY;

-- No policies = locked down for anon/authenticated; only superuser and SECURITY DEFINER functions can access

-- 2. Insert the auth key (anon key — edge function has verify_jwt=false)
INSERT INTO cron_config (id, key_name, key_value)
VALUES (1, 'send_reminder_auth_key', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZpcm1kbmdqdmN5aGZuaGFhYWZxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE3ODQyMDQsImV4cCI6MjEwNzM2MDIwNH0.nozz0ipoBjEGGN-FmGL2FHuF4-Oun0EGLaPTorwLoFg')
ON CONFLICT (id) DO UPDATE SET key_value = EXCLUDED.key_value;

-- 3. Drop existing function if re-applying
DROP FUNCTION IF EXISTS public.poll_send_reminder();

-- 4. Create the helper function in public schema
CREATE OR REPLACE FUNCTION public.poll_send_reminder()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url text := 'https://firmdngjvcyhfnhaaafq.supabase.co/functions/v1/send-reminder';
  v_key text;
  v_res json;
BEGIN
  -- Read the auth key from the secure config table
  SELECT key_value INTO v_key FROM cron_config WHERE id = 1;

  IF v_key IS NULL OR v_key = '' THEN
    RAISE NOTICE 'Auth key not found in cron_config — skipping cron poll.';
    RETURN;
  END IF;

  -- Issue the POST with Authorization and Content-Type headers
  SELECT content::json INTO v_res
  FROM http_post(
    v_url,
    '{}'::text,
    'application/json',
    ARRAY[
      'Authorization', 'Bearer ' || v_key,
      'Content-Type', 'application/json'
    ]
  );

  RAISE NOTICE 'send-reminder polled at %: %', clock_timestamp(), v_res;
END;
$$;

-- 5. Remove any pre-existing cron job with the same name (idempotent)
DO $$
BEGIN
  PERFORM cron.unschedule('poll-send-reminder');
EXCEPTION WHEN OTHERS THEN
  -- Job doesn't exist yet — that's fine
END $$;

-- 6. Register the cron job: every 2 minutes
SELECT cron.schedule(
  'poll-send-reminder',
  '*/2 * * * *',
  $$SELECT public.poll_send_reminder();$$
);
