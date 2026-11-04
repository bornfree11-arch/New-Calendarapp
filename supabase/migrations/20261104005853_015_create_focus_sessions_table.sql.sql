/*
# Create focus_sessions table for Active Focus Sessions (Phase 2)

## Purpose
Stores persistent Focus Mode sessions so an active session survives
application refresh, browser closure, and reopening. Each authenticated
user can have at most one active session at a time.

## New Tables

### focus_sessions
- id (uuid, PK)
- user_id (uuid, NOT NULL, DEFAULT auth.uid()) — owner, FK to auth.users, CASCADE on delete
- tasks (jsonb, NOT NULL) — committed task list with order, estimates, and metadata
- current_task_index (int, NOT NULL, default 0) — index into the tasks array
- task_started_at (timestamptz, nullable) — when the current task became active
- task_deadline_at (timestamptz, nullable) — absolute deadline for the current task
- completed_task_ids (jsonb, NOT NULL, default '[]') — array of task IDs marked Completed
- skipped_task_ids (jsonb, NOT NULL, default '[]') — array of task IDs skipped
- status (text, NOT NULL, default 'active', CHECK in active/completed)
- created_at (timestamptz, default now())
- updated_at (timestamptz, default now())

## Security
- RLS enabled on focus_sessions.
- 4 policies (SELECT/INSERT/UPDATE/DELETE) scoped to auth.uid() = user_id.
  INSERT policy's WITH CHECK uses auth.uid() = user_id; user_id DEFAULT auth.uid()
  means the client can omit user_id on insert safely.
- Grants: full CRUD to authenticated; full CRUD to service_role.

## Enforcement
- A partial unique index ensures only one active session per user:
  UNIQUE (user_id) WHERE status = 'active'.
  Attempting to insert a second active session for the same user fails with
  a unique-violation error, which the application handles gracefully.

## Notes
1. The committed task list (tasks jsonb) is immutable once the session starts.
   The application never modifies task order or estimates after creation.
2. task_deadline_at is the authoritative countdown reference. The application
   calculates remaining time from this timestamp, never from a JS interval.
3. Completing a task calls the existing updateTask() function to mark the
   original task as Completed. Skip does NOT change the original task status.
4. No triggers or automation on this table — all logic is application-side.
*/

CREATE TABLE IF NOT EXISTS focus_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  tasks jsonb NOT NULL,
  current_task_index int NOT NULL DEFAULT 0,
  task_started_at timestamptz,
  task_deadline_at timestamptz,
  completed_task_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  skipped_task_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','completed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE focus_sessions ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON focus_sessions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON focus_sessions TO service_role;

DROP POLICY IF EXISTS "select_own_focus_sessions" ON focus_sessions;
CREATE POLICY "select_own_focus_sessions" ON focus_sessions FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_focus_sessions" ON focus_sessions;
CREATE POLICY "insert_own_focus_sessions" ON focus_sessions FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_focus_sessions" ON focus_sessions;
CREATE POLICY "update_own_focus_sessions" ON focus_sessions FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_focus_sessions" ON focus_sessions;
CREATE POLICY "delete_own_focus_sessions" ON focus_sessions FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

-- Enforce one active session per user
CREATE UNIQUE INDEX IF NOT EXISTS idx_focus_sessions_one_active
  ON focus_sessions(user_id) WHERE status = 'active';

-- Keep updated_at fresh on every update
DROP TRIGGER IF EXISTS trg_focus_sessions_set_updated_at ON focus_sessions;
CREATE OR REPLACE FUNCTION set_focus_sessions_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION set_focus_sessions_updated_at() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION set_focus_sessions_updated_at() TO authenticated;

CREATE TRIGGER trg_focus_sessions_set_updated_at
  BEFORE UPDATE ON focus_sessions
  FOR EACH ROW EXECUTE FUNCTION set_focus_sessions_updated_at();
