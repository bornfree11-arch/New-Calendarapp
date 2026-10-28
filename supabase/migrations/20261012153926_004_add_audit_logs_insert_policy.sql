/*
# Add audit_logs INSERT policy

1. Changes
- Add INSERT policy on audit_logs for authenticated users so the app can write audit entries after mutations.
2. Security
- Any authenticated user can insert audit log entries (best-effort logging).
- SELECT remains admin-only (existing policy unchanged).
*/

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit_insert_authenticated" ON audit_logs;
CREATE POLICY "audit_insert_authenticated"
ON audit_logs FOR INSERT
TO authenticated WITH CHECK (true);