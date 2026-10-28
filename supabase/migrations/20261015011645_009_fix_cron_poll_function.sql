-- Fix the poll_send_reminder function to use the correct http_post signature.
-- The previous version called http_post with a headers array that doesn't exist
-- in this Supabase http extension, causing every cron execution to fail silently.
-- Since the Edge Function has verify_jwt=false, no Authorization header is needed.

DROP FUNCTION IF EXISTS public.poll_send_reminder();

CREATE OR REPLACE FUNCTION public.poll_send_reminder()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url text := 'https://firmdngjvcyhfnhaaafq.supabase.co/functions/v1/send-reminder';
  v_res http_response;
BEGIN
  -- POST with empty JSON body. The edge function will pick up all pending
  -- reminders whose scheduled_send_at has passed and send them.
  SELECT * INTO v_res
  FROM http_post(v_url, '{}'::varchar, 'application/json');

  RAISE NOTICE 'send-reminder polled at %: status=%', clock_timestamp(), v_res.status;
END;
$$;

-- Re-schedule the cron job to make sure it's active
DO $$
BEGIN
  PERFORM cron.unschedule('poll-send-reminder');
EXCEPTION WHEN OTHERS THEN
  -- Job doesn't exist — fine
END $$;

SELECT cron.schedule(
  'poll-send-reminder',
  '*/2 * * * *',
  $$SELECT public.poll_send_reminder();$$
);
