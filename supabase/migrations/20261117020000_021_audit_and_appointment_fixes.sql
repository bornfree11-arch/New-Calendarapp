/*
# Full Appointment Audit Snapshots & Admin Status Update RLS Fix

1. Updates `public.log_appointment_changes()` so DB trigger audit rows on
   `public.appointments` always include full `previous_values` and `new_values`
   snapshots (excluding `company_snapshot` and `time_range`), preventing blank
   `appointment.update` rows when fields like `notes`, `client_phone`, `client_email`,
   `company_id`, `customer_id`, or `send_whatsapp` change.
2. Updates `"Appointments update restriction"` on `public.appointments` so users
   with `profiles.role = 'admin'` (in addition to `user_metadata.role = 'administrator'`
   and the assigned owner `assigned_to = auth.uid()`) can update appointment statuses
   without hitting RLS permission errors.
*/

CREATE OR REPLACE FUNCTION public.log_appointment_changes()
RETURNS trigger AS $$
DECLARE
  actor_id uuid := COALESCE(auth.uid(), CASE WHEN TG_OP = 'DELETE' THEN OLD.last_modified_by ELSE NEW.last_modified_by END);
  action_str text;
  summary text;
  prev_json jsonb;
  new_json jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    action_str := 'appointment.create';
    summary := format('Created appointment for %s (%s) on %s', NEW.client_name, NEW.appointment_type, NEW.appointment_date);
    prev_json := NULL;
    new_json := to_jsonb(NEW) - 'company_snapshot' - 'time_range';
  ELSIF TG_OP = 'UPDATE' THEN
    action_str := 'appointment.update';
    summary := format('Updated appointment for %s', NEW.client_name);

    IF OLD.status IS DISTINCT FROM NEW.status THEN
      summary := format('Changed status from %s to %s for %s on %s', OLD.status, NEW.status, NEW.client_name, NEW.appointment_date);
    ELSIF OLD.assigned_to IS DISTINCT FROM NEW.assigned_to THEN
      summary := format('Reassigned appointment for %s', NEW.client_name);
    ELSIF OLD.appointment_date IS DISTINCT FROM NEW.appointment_date OR OLD.start_time IS DISTINCT FROM NEW.start_time THEN
      summary := format('Rescheduled appointment for %s to %s at %s', NEW.client_name, NEW.appointment_date, NEW.start_time);
    END IF;

    prev_json := to_jsonb(OLD) - 'company_snapshot' - 'time_range';
    new_json := to_jsonb(NEW) - 'company_snapshot' - 'time_range';
  ELSIF TG_OP = 'DELETE' THEN
    action_str := 'appointment.delete';
    summary := format('Deleted appointment for %s on %s', OLD.client_name, OLD.appointment_date);
    prev_json := to_jsonb(OLD) - 'company_snapshot' - 'time_range';
    new_json := NULL;
    INSERT INTO public.audit_logs (user_id, action_type, table_name, record_id, change_summary, previous_values, new_values)
    VALUES (actor_id, action_str, 'appointments', OLD.id, summary, prev_json, new_json);
    RETURN OLD;
  END IF;

  INSERT INTO public.audit_logs (user_id, action_type, table_name, record_id, change_summary, previous_values, new_values)
  VALUES (actor_id, action_str, 'appointments', NEW.id, summary, prev_json, new_json);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP POLICY IF EXISTS "Appointments update restriction" ON public.appointments;
CREATE POLICY "Appointments update restriction" ON public.appointments
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'admin'
    ) OR
    (auth.jwt() -> 'user_metadata' ->> 'role' = 'administrator') OR
    (assigned_to = auth.uid())
  )
  WITH CHECK (
    CASE
      WHEN EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid() AND p.role = 'admin'
      ) OR (auth.jwt() -> 'user_metadata' ->> 'role' = 'administrator') THEN true
      ELSE (assigned_to = auth.uid())
    END
  );
