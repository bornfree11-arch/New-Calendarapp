/*
# Delivery Failure Monitoring for WhatsApp Messages

## Overview
Adds persistent tracking for Bird WhatsApp message delivery statuses. When a message
is sent via Bird, an attempt record is created with the Bird message ID. Bird webhooks
update the attempt status. Failed/rejected deliveries create alert records visible to
the owner via a persistent notification indicator.

## New Tables
1. `reminder_attempts` — One row per send attempt. Stores Bird message ID, delivery
   status, error details, and the original message content/parameters needed for retry.
   Links back to the `reminders` table.
2. `webhook_events` — Deduplication log for Bird webhook deliveries. Each Bird webhook
   has a unique `webhook-id`; storing processed IDs prevents duplicate processing.
3. `delivery_alerts` — Outstanding failure alerts shown in the Message Status Center.
   Tracks acknowledgment (owner reviewed) and resolution (problem fixed) separately.

## Columns
### reminder_attempts
- id (uuid PK)
- reminder_id (uuid FK → reminders, ON DELETE CASCADE)
- appointment_id (uuid FK → appointments, ON DELETE CASCADE)
- bird_message_id (text, unique) — Bird's wam_ ID for this attempt
- channel (text) — 'sms' (WhatsApp) or 'email'
- recipient_address (text) — phone or email
- delivery_status (text) — 'pending'|'accepted'|'sent'|'delivered'|'read'|'failed'|'rejected'
- error_code (text) — Bird error.code
- error_description (text) — Bird error.description
- error_meta_code (text) — Bird error.meta_error_code
- status_timestamp (timestamptz) — when the last status event was received
- template_slug (text) — WhatsApp template used (e.g. 'appointment_confirmation')
- template_params (jsonb) — parameters used to fill the template (for safe retry)
- original_message (text) — human-readable summary of the message content
- agent_notified (boolean) — whether the assigned agent was notified of failure
- agent_notification_status (text) — 'pending'|'sent'|'failed'|'skipped'
- is_retry (boolean) — true if this attempt is a manual retry
- parent_attempt_id (uuid FK → reminder_attempts, nullable) — original attempt this retries
- resolved_by_retry (boolean) — true if a successful retry resolved this failure
- created_at (timestamptz)

### webhook_events
- id (uuid PK)
- webhook_id (text, unique) — Bird's webhook-id header
- event_type (text) — e.g. 'whatsapp.failed'
- bird_message_id (text) — whatsapp_id from the payload
- processed_at (timestamptz)

### delivery_alerts
- id (uuid PK)
- attempt_id (uuid FK → reminder_attempts, ON DELETE CASCADE)
- acknowledged (boolean, default false) — owner reviewed the failure
- acknowledged_at (timestamptz, nullable)
- acknowledged_by (uuid FK → profiles, nullable)
- resolved (boolean, default false) — underlying problem addressed
- resolved_at (timestamptz, nullable)
- resolved_by (uuid FK → profiles, nullable)
- created_at (timestamptz)

## Security
- All tables have RLS enabled.
- SELECT/UPDATE on all three tables granted to `authenticated` (admin-only via policy predicate).
- INSERT is allowed for `authenticated` with permissive policies (edge functions use service role
  which bypasses RLS, but the frontend also needs to insert webhook_events for safety).
- Admin-only access enforced via EXISTS check on profiles.role = 'admin'.
- service_role is granted full access for edge functions.
*/

-- ============================================================================
-- REMINDER_ATTEMPTS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS reminder_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reminder_id uuid REFERENCES reminders(id) ON DELETE CASCADE,
  appointment_id uuid REFERENCES appointments(id) ON DELETE CASCADE,
  bird_message_id text UNIQUE,
  channel text NOT NULL DEFAULT 'sms' CHECK (channel IN ('sms', 'email')),
  recipient_address text NOT NULL,
  delivery_status text NOT NULL DEFAULT 'pending' CHECK (
    delivery_status IN ('pending', 'accepted', 'sent', 'delivered', 'read', 'failed', 'rejected')
  ),
  error_code text,
  error_description text,
  error_meta_code text,
  status_timestamp timestamptz,
  template_slug text,
  template_params jsonb,
  original_message text,
  agent_notified boolean NOT NULL DEFAULT false,
  agent_notification_status text NOT NULL DEFAULT 'pending' CHECK (
    agent_notification_status IN ('pending', 'sent', 'failed', 'skipped')
  ),
  is_retry boolean NOT NULL DEFAULT false,
  parent_attempt_id uuid REFERENCES reminder_attempts(id) ON DELETE SET NULL,
  resolved_by_retry boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_attempt_bird_msg ON reminder_attempts (bird_message_id);
CREATE INDEX IF NOT EXISTS idx_attempt_reminder ON reminder_attempts (reminder_id);
CREATE INDEX IF NOT EXISTS idx_attempt_appt ON reminder_attempts (appointment_id);
CREATE INDEX IF NOT EXISTS idx_attempt_status ON reminder_attempts (delivery_status);

ALTER TABLE reminder_attempts ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON reminder_attempts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON reminder_attempts TO service_role;

DROP POLICY IF EXISTS "attempts_select_admin" ON reminder_attempts;
CREATE POLICY "attempts_select_admin"
  ON reminder_attempts FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );

DROP POLICY IF EXISTS "attempts_insert_admin" ON reminder_attempts;
CREATE POLICY "attempts_insert_admin"
  ON reminder_attempts FOR INSERT TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );

DROP POLICY IF EXISTS "attempts_update_admin" ON reminder_attempts;
CREATE POLICY "attempts_update_admin"
  ON reminder_attempts FOR UPDATE TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );

DROP POLICY IF EXISTS "attempts_delete_admin" ON reminder_attempts;
CREATE POLICY "attempts_delete_admin"
  ON reminder_attempts FOR DELETE TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );

-- ============================================================================
-- WEBHOOK_EVENTS TABLE (deduplication)
-- ============================================================================
CREATE TABLE IF NOT EXISTS webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id text UNIQUE NOT NULL,
  event_type text NOT NULL,
  bird_message_id text,
  processed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_webhook_bird_msg ON webhook_events (bird_message_id);

ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON webhook_events TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON webhook_events TO service_role;

DROP POLICY IF EXISTS "webhook_select_admin" ON webhook_events;
CREATE POLICY "webhook_select_admin"
  ON webhook_events FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );

DROP POLICY IF EXISTS "webhook_insert_admin" ON webhook_events;
CREATE POLICY "webhook_insert_admin"
  ON webhook_events FOR INSERT TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );

DROP POLICY IF EXISTS "webhook_update_admin" ON webhook_events;
CREATE POLICY "webhook_update_admin"
  ON webhook_events FOR UPDATE TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );

DROP POLICY IF EXISTS "webhook_delete_admin" ON webhook_events;
CREATE POLICY "webhook_delete_admin"
  ON webhook_events FOR DELETE TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );

-- ============================================================================
-- DELIVERY_ALERTS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS delivery_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id uuid NOT NULL REFERENCES reminder_attempts(id) ON DELETE CASCADE,
  acknowledged boolean NOT NULL DEFAULT false,
  acknowledged_at timestamptz,
  acknowledged_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  resolved boolean NOT NULL DEFAULT false,
  resolved_at timestamptz,
  resolved_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_alert_attempt ON delivery_alerts (attempt_id);
CREATE INDEX IF NOT EXISTS idx_alert_ack ON delivery_alerts (acknowledged);
CREATE INDEX IF NOT EXISTS idx_alert_resolved ON delivery_alerts (resolved);

ALTER TABLE delivery_alerts ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON delivery_alerts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON delivery_alerts TO service_role;

DROP POLICY IF EXISTS "alerts_select_admin" ON delivery_alerts;
CREATE POLICY "alerts_select_admin"
  ON delivery_alerts FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );

DROP POLICY IF EXISTS "alerts_insert_admin" ON delivery_alerts;
CREATE POLICY "alerts_insert_admin"
  ON delivery_alerts FOR INSERT TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );

DROP POLICY IF EXISTS "alerts_update_admin" ON delivery_alerts;
CREATE POLICY "alerts_update_admin"
  ON delivery_alerts FOR UPDATE TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );

DROP POLICY IF EXISTS "alerts_delete_admin" ON delivery_alerts;
CREATE POLICY "alerts_delete_admin"
  ON delivery_alerts FOR DELETE TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );
