/*
# Support Rescheduled Appointment Status & Calendar Sent Email Logging

## Summary
1. Extends `public.appointments` (Calendar-owned table) to allow `'Rescheduled'` status
   and keeps reminders / overlap protection active for `'Rescheduled'` appointments.
2. Safely ensures `public.sent_emails` has nullable linking/source columns (`customer_id`,
   `source_app`, `channel`, `recipient_phone`, `appointment_id`) via `ADD COLUMN IF NOT EXISTS`
   WITHOUT modifying or dropping any existing columns or constraints on `public.sent_emails`,
   `public.companies`, `public.app_users`, or `public.payroll_runs`.
*/

-- ============================================================================
-- 1. Allow 'Rescheduled' on public.appointments
-- ============================================================================
ALTER TABLE public.appointments
  DROP CONSTRAINT IF EXISTS appointments_status_check;

ALTER TABLE public.appointments
  ADD CONSTRAINT appointments_status_check
  CHECK (status IN ('Scheduled', 'Completed', 'Cancelled', 'No-show', 'Rescheduled'));

ALTER TABLE public.appointments
  DROP CONSTRAINT IF EXISTS no_same_coworker_overlap;

ALTER TABLE public.appointments
  ADD CONSTRAINT no_same_coworker_overlap
  EXCLUDE USING gist (
    assigned_to WITH =,
    time_range WITH &&
  ) WHERE (status IN ('Scheduled', 'Rescheduled'));

-- Keep reminders active for both Scheduled and Rescheduled appointments
CREATE OR REPLACE FUNCTION public.upsert_reminders(appt_id uuid)
RETURNS void AS $$
DECLARE
  appt appointments%ROWTYPE;
  coworker_profile profiles%ROWTYPE;
  send_time timestamptz;
BEGIN
  SELECT * INTO appt FROM appointments WHERE id = appt_id;
  IF NOT FOUND THEN
    UPDATE reminders SET status = 'cancelled', error_details = 'Appointment deleted'
    WHERE appointment_id = appt_id AND status = 'pending';
    RETURN;
  END IF;

  IF appt.status = 'Cancelled' THEN
    UPDATE reminders SET status = 'cancelled', error_details = 'Appointment cancelled'
    WHERE appointment_id = appt_id AND status = 'pending';
    RETURN;
  END IF;

  IF appt.status NOT IN ('Scheduled', 'Rescheduled') THEN
    UPDATE reminders SET status = 'cancelled', error_details = 'Appointment not in Scheduled state'
    WHERE appointment_id = appt_id AND status = 'pending';
    RETURN;
  END IF;

  send_time = (appt.appointment_date::text || ' 08:00:00')::timestamp AT TIME ZONE 'America/New_York';

  SELECT * INTO coworker_profile FROM profiles WHERE id = appt.assigned_to;
  IF NOT FOUND THEN RETURN; END IF;

  IF coworker_profile.email IS NOT NULL AND coworker_profile.email != '' THEN
    INSERT INTO reminders (appointment_id, recipient_type, recipient_address, scheduled_send_at, status)
    VALUES (appt_id, 'coworker', coworker_profile.email, send_time, 'pending')
    ON CONFLICT (appointment_id, recipient_type) DO UPDATE
    SET scheduled_send_at = EXCLUDED.scheduled_send_at,
        status = CASE WHEN reminders.status IN ('sent', 'failed') THEN reminders.status ELSE 'pending' END,
        error_details = CASE WHEN reminders.status IN ('sent', 'failed') THEN reminders.error_details ELSE '' END;
  END IF;

  IF appt.client_email IS NOT NULL AND appt.client_email != '' THEN
    INSERT INTO reminders (appointment_id, recipient_type, recipient_address, scheduled_send_at, status)
    VALUES (appt_id, 'client', appt.client_email, send_time, 'pending')
    ON CONFLICT (appointment_id, recipient_type) DO UPDATE
    SET scheduled_send_at = EXCLUDED.scheduled_send_at,
        recipient_address = EXCLUDED.recipient_address,
        status = CASE WHEN reminders.status IN ('sent', 'failed') THEN reminders.status ELSE 'pending' END,
        error_details = CASE WHEN reminders.status IN ('sent', 'failed') THEN reminders.error_details ELSE '' END;
  ELSE
    INSERT INTO reminders (appointment_id, recipient_type, recipient_address, scheduled_send_at, status, error_details)
    VALUES (appt_id, 'client', '', send_time, 'skipped', 'No client email on appointment')
    ON CONFLICT (appointment_id, recipient_type) DO UPDATE
    SET status = CASE WHEN reminders.status IN ('sent', 'failed') THEN reminders.status ELSE 'skipped' END,
        error_details = CASE WHEN reminders.status IN ('sent', 'failed') THEN reminders.error_details ELSE 'No client email on appointment' END;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 2. Additive-only support for Calendar logging on public.sent_emails
--    (Does NOT modify or drop any existing columns or constraints)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.sent_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_email text NOT NULL DEFAULT '',
  subject text NOT NULL DEFAULT '',
  body text,
  status text NOT NULL DEFAULT 'sent',
  sent_at timestamptz DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.sent_emails
  ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_app text,
  ADD COLUMN IF NOT EXISTS channel text,
  ADD COLUMN IF NOT EXISTS recipient_phone text,
  ADD COLUMN IF NOT EXISTS appointment_id uuid REFERENCES public.appointments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sent_emails_customer_id ON public.sent_emails (customer_id);
CREATE INDEX IF NOT EXISTS idx_sent_emails_recipient_email ON public.sent_emails (lower(recipient_email));
CREATE INDEX IF NOT EXISTS idx_sent_emails_recipient_phone ON public.sent_emails (recipient_phone);

ALTER TABLE public.sent_emails ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT ON public.sent_emails TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sent_emails TO service_role;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'sent_emails' AND cmd = 'SELECT'
  ) THEN
    CREATE POLICY "sent_emails_select_authenticated"
      ON public.sent_emails FOR SELECT TO authenticated USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'sent_emails' AND cmd = 'INSERT'
  ) THEN
    CREATE POLICY "sent_emails_insert_authenticated"
      ON public.sent_emails FOR INSERT TO authenticated WITH CHECK (true);
  END IF;
END $$;
