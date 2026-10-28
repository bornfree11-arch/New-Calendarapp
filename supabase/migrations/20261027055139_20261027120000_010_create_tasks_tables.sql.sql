/*
# Create Tasks, Subtasks, and Task Status History

## Purpose
Adds a secure, per-user To-Do feature to the Shared Calendar app.
Each task belongs only to the signed-in user. The database enforces
ownership; the browser never supplies an owner value.

## New Tables

### tasks
- id (uuid, PK)
- user_id (uuid, NOT NULL, DEFAULT auth.uid()) — owner, FK to auth.users, CASCADE on delete
- title (text, NOT NULL)
- action_category (text, NOT NULL, CHECK in Call/Email/Text/Personal/Other)
- notes (text, default '')
- due_date (date, nullable)
- status (text, NOT NULL, default 'Not Started', CHECK in
  Not Started/In Progress/On Hold/Cancelled/Completed)
- created_at (timestamptz, default now())
- updated_at (timestamptz, default now())
- completed_at (timestamptz, nullable — set when status becomes Completed)

### subtasks
- id (uuid, PK)
- task_id (uuid, NOT NULL, FK to tasks.id, CASCADE on delete)
- title (text, NOT NULL)
- completed (boolean, NOT NULL, default false)
- created_at (timestamptz, default now())
- updated_at (timestamptz, default now())
(Ownership derived through task_id; no separate user_id column.)

### task_status_history
- id (uuid, PK)
- task_id (uuid, NOT NULL, FK to tasks.id, CASCADE on delete)
- from_status (text, nullable — null on creation)
- to_status (text, NOT NULL)
- changed_by (uuid, NOT NULL, FK to auth.users.id)
- changed_at (timestamptz, default now())

## Security
- RLS enabled on all three tables.
- tasks: 4 policies (SELECT/INSERT/UPDATE/DELETE) scoped to auth.uid() = user_id.
  INSERT policy's WITH CHECK uses auth.uid() = user_id; user_id DEFAULT auth.uid()
  means the client can omit user_id on insert safely.
- subtasks: 4 policies scoped through parent task ownership via EXISTS subquery.
- task_status_history: SELECT scoped to the task owner; INSERT allowed for the
  task owner (the trigger writes rows; the app does not insert directly). No
  UPDATE or DELETE — history is permanent.
- Grants: tasks/subtasks full CRUD to authenticated; task_status_history
  SELECT + INSERT to authenticated. service_role gets full access for
  edge-function use if needed later.
- REVOKE EXECUTE on the status-history trigger function from PUBLIC/anon so
  only the database can call it.

## Automation
- A BEFORE UPDATE trigger on tasks compares OLD.status vs NEW.status. When they
  differ (or when a row is created via INSERT with a non-null status), it
  inserts a task_status_history row recording from/to and the actor (auth.uid()).
- A separate BEFORE INSERT trigger logs the initial status as a "Created"
  history row (from_status NULL).
- When status transitions to 'Completed', completed_at is stamped; when it
  moves away from Completed, completed_at is cleared.

## Notes
1. Ownership is server-enforced. The browser never sends user_id; the column
   default fills it from the authenticated session.
2. Status history is append-only and recorded by a trigger, not client code.
3. Subtasks do not auto-complete the parent task under any condition.
*/

CREATE TABLE IF NOT EXISTS tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  action_category text NOT NULL DEFAULT 'Other'
    CHECK (action_category IN ('Call','Email','Text','Personal','Other')),
  notes text NOT NULL DEFAULT '',
  due_date date,
  status text NOT NULL DEFAULT 'Not Started'
    CHECK (status IN ('Not Started','In Progress','On Hold','Cancelled','Completed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON tasks TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON tasks TO service_role;

DROP POLICY IF EXISTS "select_own_tasks" ON tasks;
CREATE POLICY "select_own_tasks" ON tasks FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_tasks" ON tasks;
CREATE POLICY "insert_own_tasks" ON tasks FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_tasks" ON tasks;
CREATE POLICY "update_own_tasks" ON tasks FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_tasks" ON tasks;
CREATE POLICY "delete_own_tasks" ON tasks FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_tasks_user_due ON tasks(user_id, due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_user_status ON tasks(user_id, status);

CREATE TABLE IF NOT EXISTS subtasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  title text NOT NULL,
  completed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE subtasks ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON subtasks TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON subtasks TO service_role;

DROP POLICY IF EXISTS "select_own_subtasks" ON subtasks;
CREATE POLICY "select_own_subtasks" ON subtasks FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM tasks t WHERE t.id = subtasks.task_id AND t.user_id = auth.uid()));

DROP POLICY IF EXISTS "insert_own_subtasks" ON subtasks;
CREATE POLICY "insert_own_subtasks" ON subtasks FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM tasks t WHERE t.id = subtasks.task_id AND t.user_id = auth.uid()));

DROP POLICY IF EXISTS "update_own_subtasks" ON subtasks;
CREATE POLICY "update_own_subtasks" ON subtasks FOR UPDATE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM tasks t WHERE t.id = subtasks.task_id AND t.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM tasks t WHERE t.id = subtasks.task_id AND t.user_id = auth.uid()));

DROP POLICY IF EXISTS "delete_own_subtasks" ON subtasks;
CREATE POLICY "delete_own_subtasks" ON subtasks FOR DELETE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM tasks t WHERE t.id = subtasks.task_id AND t.user_id = auth.uid()));

CREATE INDEX IF NOT EXISTS idx_subtasks_task ON subtasks(task_id);

CREATE TABLE IF NOT EXISTS task_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  from_status text,
  to_status text NOT NULL,
  changed_by uuid NOT NULL REFERENCES auth.users(id),
  changed_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE task_status_history ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT ON task_status_history TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON task_status_history TO service_role;

DROP POLICY IF EXISTS "select_own_task_history" ON task_status_history;
CREATE POLICY "select_own_task_history" ON task_status_history FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM tasks t WHERE t.id = task_status_history.task_id AND t.user_id = auth.uid()));

DROP POLICY IF EXISTS "insert_own_task_history" ON task_status_history;
CREATE POLICY "insert_own_task_history" ON task_status_history FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM tasks t WHERE t.id = task_status_history.task_id AND t.user_id = auth.uid()));

CREATE INDEX IF NOT EXISTS idx_task_history_task ON task_status_history(task_id, changed_at);

-- Function to record a status-history row. Called by triggers.
-- SECURITY DEFINER so it can write to task_status_history even though
-- the calling role only has INSERT on that table via policy. We revoke
-- EXECUTE from PUBLIC/anon so it cannot be called as an RPC.
CREATE OR REPLACE FUNCTION record_task_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- On INSERT: log the creation with from_status NULL.
  IF TG_OP = 'INSERT' THEN
    INSERT INTO task_status_history (task_id, from_status, to_status, changed_by, changed_at)
    VALUES (NEW.id, NULL, COALESCE(NEW.status, 'Not Started'), auth.uid(), now());
    RETURN NEW;
  END IF;

  -- On UPDATE: only log when the status actually changed.
  IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO task_status_history (task_id, from_status, to_status, changed_by, changed_at)
    VALUES (NEW.id, OLD.status, NEW.status, auth.uid(), now());

    -- Stamp/clear completed_at based on the new status.
    IF NEW.status = 'Completed' AND OLD.status <> 'Completed' THEN
      NEW.completed_at := now();
    ELSIF NEW.status <> 'Completed' AND OLD.status = 'Completed' THEN
      NEW.completed_at := NULL;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION record_task_status_change() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION record_task_status_change() TO authenticated;

DROP TRIGGER IF EXISTS trg_tasks_status_history_insert ON tasks;
CREATE TRIGGER trg_tasks_status_history_insert
  BEFORE INSERT ON tasks
  FOR EACH ROW EXECUTE FUNCTION record_task_status_change();

DROP TRIGGER IF EXISTS trg_tasks_status_history_update ON tasks;
CREATE TRIGGER trg_tasks_status_history_update
  BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION record_task_status_change();

-- Keep updated_at fresh on every update.
DROP TRIGGER IF EXISTS trg_tasks_set_updated_at ON tasks;
CREATE OR REPLACE FUNCTION set_tasks_updated_at()
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
REVOKE EXECUTE ON FUNCTION set_tasks_updated_at() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION set_tasks_updated_at() TO authenticated;

CREATE TRIGGER trg_tasks_set_updated_at
  BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION set_tasks_updated_at();

DROP TRIGGER IF EXISTS trg_subtasks_set_updated_at ON subtasks;
CREATE OR REPLACE FUNCTION set_subtasks_updated_at()
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
REVOKE EXECUTE ON FUNCTION set_subtasks_updated_at() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION set_subtasks_updated_at() TO authenticated;

CREATE TRIGGER trg_subtasks_set_updated_at
  BEFORE UPDATE ON subtasks
  FOR EACH ROW EXECUTE FUNCTION set_subtasks_updated_at();
