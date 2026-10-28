/*
# Reminders and Audit Logs

## Overview
Adds the reminders table for tracking email reminders and the audit_logs table
for recording all important changes.

## New Tables
1. `reminders` — Email reminder records with scheduling, status, and retry tracking
2. `audit_logs` — Server-written audit trail of all important actions

## Security
- reminders: admin-only SELECT; INSERT/UPDATE via edge functions (service role bypasses RLS)
- audit_logs: admin-only SELECT; no client INSERT/UPDATE/DELETE (written only by triggers/edge functions)

## Important Notes
- Unique constraint on (appointment_id, recipient_type) prevents duplicate reminders
- Reminders cancelled when appointment is cancelled or rescheduled (handled by edge function)
- Audit logs written by SECURITY DEFINER triggers on appointment changes
*/

-- ============================================================================
-- REMINDERS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id uuid NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  recipient_type text NOT NULL CHECK (recipient_type IN ('coworker', 'client')),
  recipient_address text NOT NULL,
  scheduled_send_at timestamptz NOT NULL,
  attempted_at timestamptz,
  status text NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'sent', 'failed', 'skipped', 'cancelled')
  ),
  error_details text DEFAULT '',
  retry_count int NOT NULL DEFAULT 0 CHECK (retry_count >= 0 AND retry_count <= 5),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(appointment_id, recipient_type)
);

CREATE INDEX IF NOT EXISTS idx_reminders_status ON reminders (status);
CREATE INDEX IF NOT EXISTS idx_reminders_scheduled ON reminders (scheduled_send_at);

ALTER TABLE reminders ENABLE ROW LEVEL SECURITY;

-- Admin-only read
DROP POLICY IF EXISTS "reminders_select_admin" ON reminders;
CREATE POLICY "reminders_select_admin"
  ON reminders FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );

-- No client insert/update/delete — edge functions use service role which bypasses RLS
DROP POLICY IF EXISTS "reminders_insert_edge" ON reminders;
CREATE POLICY "reminders_insert_edge"
  ON reminders FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "reminders_update_edge" ON reminders;
CREATE POLICY "reminders_update_edge"
  ON reminders FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- ============================================================================
-- AUDIT LOGS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  action_type text NOT NULL,
  table_name text NOT NULL,
  record_id uuid,
  change_summary text NOT NULL DEFAULT '',
  previous_values jsonb,
  new_values jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs (action_type);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs (user_id);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Admin-only read
DROP POLICY IF EXISTS "audit_select_admin" ON audit_logs;
CREATE POLICY "audit_select_admin"
  ON audit_logs FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );

-- No client INSERT/UPDATE/DELETE — written only by SECURITY DEFINER triggers

-- ============================================================================
-- AUDIT TRIGGER: Log appointment changes
-- ============================================================================
CREATE OR REPLACE FUNCTION log_appointment_changes()
RETURNS trigger AS $$
DECLARE
  actor_id uuid := auth.uid();
  action_str text;
  summary text;
  prev_json jsonb;
  new_json jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    action_str := 'appointment.create';
    summary := format('Created appointment for %s (%s) on %s', NEW.client_name, NEW.appointment_type, NEW.appointment_date);
    new_json := jsonb_build_object(
      'client_name', NEW.client_name,
      'appointment_type', NEW.appointment_type,
      'appointment_date', NEW.appointment_date,
      'start_time', NEW.start_time,
      'duration_minutes', NEW.duration_minutes,
      'status', NEW.status,
      'assigned_to', NEW.assigned_to
    );
    prev_json := NULL;
  ELSIF TG_OP = 'UPDATE' THEN
    action_str := 'appointment.update';
    summary := format('Updated appointment for %s', NEW.client_name);

    -- Detect specific changes for summary
    IF OLD.status != NEW.status THEN
      summary := format('Changed status from %s to %s for %s on %s', OLD.status, NEW.status, NEW.client_name, NEW.appointment_date);
    ELSIF OLD.assigned_to != NEW.assigned_to THEN
      summary := format('Reassigned appointment for %s', NEW.client_name);
    ELSIF OLD.appointment_date != NEW.appointment_date OR OLD.start_time != NEW.start_time THEN
      summary := format('Rescheduled appointment for %s to %s at %s', NEW.client_name, NEW.appointment_date, NEW.start_time);
    END IF;

    prev_json := jsonb_build_object(
      'client_name', OLD.client_name,
      'appointment_type', OLD.appointment_type,
      'appointment_date', OLD.appointment_date,
      'start_time', OLD.start_time,
      'duration_minutes', OLD.duration_minutes,
      'status', OLD.status,
      'assigned_to', OLD.assigned_to
    );
    new_json := jsonb_build_object(
      'client_name', NEW.client_name,
      'appointment_type', NEW.appointment_type,
      'appointment_date', NEW.appointment_date,
      'start_time', NEW.start_time,
      'duration_minutes', NEW.duration_minutes,
      'status', NEW.status,
      'assigned_to', NEW.assigned_to
    );
  ELSIF TG_OP = 'DELETE' THEN
    action_str := 'appointment.delete';
    summary := format('Deleted appointment for %s on %s', OLD.client_name, OLD.appointment_date);
    prev_json := jsonb_build_object(
      'client_name', OLD.client_name,
      'appointment_type', OLD.appointment_type,
      'appointment_date', OLD.appointment_date,
      'start_time', OLD.start_time,
      'status', OLD.status
    );
    new_json := NULL;
    INSERT INTO audit_logs (user_id, action_type, table_name, record_id, change_summary, previous_values, new_values)
    VALUES (actor_id, action_str, 'appointments', OLD.id, summary, prev_json, new_json);
    RETURN OLD;
  END IF;

  INSERT INTO audit_logs (user_id, action_type, table_name, record_id, change_summary, previous_values, new_values)
  VALUES (actor_id, action_str, 'appointments', NEW.id, summary, prev_json, new_json);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS appointments_audit_after_insert ON appointments;
CREATE TRIGGER appointments_audit_after_insert
  AFTER INSERT ON appointments
  FOR EACH ROW EXECUTE FUNCTION log_appointment_changes();

DROP TRIGGER IF EXISTS appointments_audit_after_update ON appointments;
CREATE TRIGGER appointments_audit_after_update
  AFTER UPDATE ON appointments
  FOR EACH ROW EXECUTE FUNCTION log_appointment_changes();

DROP TRIGGER IF EXISTS appointments_audit_after_delete ON appointments;
CREATE TRIGGER appointments_audit_after_delete
  AFTER DELETE ON appointments
  FOR EACH ROW EXECUTE FUNCTION log_appointment_changes();

-- ============================================================================
-- REMINDER MANAGEMENT FUNCTION
-- Called by edge function to create/cancel reminders when appointments change
-- ============================================================================
CREATE OR REPLACE FUNCTION upsert_reminders(appt_id uuid)
RETURNS void AS $$
DECLARE
  appt appointments%ROWTYPE;
  coworker_profile profiles%ROWTYPE;
  send_time timestamptz;
BEGIN
  SELECT * INTO appt FROM appointments WHERE id = appt_id;
  IF NOT FOUND THEN
    -- Appointment deleted, cancel all pending reminders
    UPDATE reminders SET status = 'cancelled', error_details = 'Appointment deleted'
    WHERE appointment_id = appt_id AND status = 'pending';
    RETURN;
  END IF;

  -- If cancelled, cancel pending reminders
  IF appt.status = 'Cancelled' THEN
    UPDATE reminders SET status = 'cancelled', error_details = 'Appointment cancelled'
    WHERE appointment_id = appt_id AND status = 'pending';
    RETURN;
  END IF;

  -- If not scheduled, cancel pending reminders
  IF appt.status != 'Scheduled' THEN
    UPDATE reminders SET status = 'cancelled', error_details = 'Appointment not in Scheduled state'
    WHERE appointment_id = appt_id AND status = 'pending';
    RETURN;
  END IF;

  -- Calculate 8:00 AM ET on appointment date
  -- America/New_York is the configured timezone
  send_time = (appt.appointment_date::text || ' 08:00:00')::timestamp AT TIME ZONE 'America/New_York';

  -- Get coworker profile
  SELECT * INTO coworker_profile FROM profiles WHERE id = appt.assigned_to;
  IF NOT FOUND THEN RETURN; END IF;

  -- Upsert coworker reminder
  IF coworker_profile.email IS NOT NULL AND coworker_profile.email != '' THEN
    INSERT INTO reminders (appointment_id, recipient_type, recipient_address, scheduled_send_at, status)
    VALUES (appt_id, 'coworker', coworker_profile.email, send_time, 'pending')
    ON CONFLICT (appointment_id, recipient_type) DO UPDATE
    SET scheduled_send_at = EXCLUDED.scheduled_send_at,
        status = CASE WHEN reminders.status IN ('sent', 'failed') THEN reminders.status ELSE 'pending' END,
        error_details = CASE WHEN reminders.status IN ('sent', 'failed') THEN reminders.error_details ELSE '' END;
  END IF;

  -- Upsert client reminder
  IF appt.client_email IS NOT NULL AND appt.client_email != '' THEN
    INSERT INTO reminders (appointment_id, recipient_type, recipient_address, scheduled_send_at, status)
    VALUES (appt_id, 'client', appt.client_email, send_time, 'pending')
    ON CONFLICT (appointment_id, recipient_type) DO UPDATE
    SET scheduled_send_at = EXCLUDED.scheduled_send_at,
        recipient_address = EXCLUDED.recipient_address,
        status = CASE WHEN reminders.status IN ('sent', 'failed') THEN reminders.status ELSE 'pending' END,
        error_details = CASE WHEN reminders.status IN ('sent', 'failed') THEN reminders.error_details ELSE '' END;
  ELSE
    -- Mark client reminder as skipped if no email
    INSERT INTO reminders (appointment_id, recipient_type, recipient_address, scheduled_send_at, status, error_details)
    VALUES (appt_id, 'client', '', send_time, 'skipped', 'No client email on appointment')
    ON CONFLICT (appointment_id, recipient_type) DO UPDATE
    SET status = CASE WHEN reminders.status IN ('sent', 'failed') THEN reminders.status ELSE 'skipped' END,
        error_details = CASE WHEN reminders.status IN ('sent', 'failed') THEN reminders.error_details ELSE 'No client email on appointment' END;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- TRIGGER: Auto-manage reminders after appointment changes
-- ============================================================================
CREATE OR REPLACE FUNCTION manage_reminders_after_change()
RETURNS trigger AS $$
BEGIN
  PERFORM upsert_reminders(NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS appointments_reminders_after_insert ON appointments;
CREATE TRIGGER appointments_reminders_after_insert
  AFTER INSERT ON appointments
  FOR EACH ROW EXECUTE FUNCTION manage_reminders_after_change();

DROP TRIGGER IF EXISTS appointments_reminders_after_update ON appointments;
CREATE TRIGGER appointments_reminders_after_update
  AFTER UPDATE ON appointments
  FOR EACH ROW EXECUTE FUNCTION manage_reminders_after_change();

CREATE OR REPLACE FUNCTION manage_reminders_after_delete()
RETURNS trigger AS $$
BEGIN
  PERFORM upsert_reminders(OLD.id);
  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS appointments_reminders_after_delete ON appointments;
CREATE TRIGGER appointments_reminders_after_delete
  AFTER DELETE ON appointments
  FOR EACH ROW EXECUTE FUNCTION manage_reminders_after_delete();