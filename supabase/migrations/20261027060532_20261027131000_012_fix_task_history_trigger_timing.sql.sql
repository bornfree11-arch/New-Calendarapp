/*
# Fix task-save: move status-history logging to AFTER INSERT/UPDATE trigger

## Root cause (continued from migration 011)
The BEFORE INSERT trigger tried to write a row into `task_status_history`
referencing `NEW.id` before the parent `tasks` row existed, so the
`task_status_history_task_id_fkey` foreign key failed and rolled back the
whole insert. The earlier migration fixed the NULL `changed_by` (auth.uid()
issue) but the trigger was still BEFORE, so the FK on task_id still rejected
the insert.

## Fix
1. Replace `record_task_status_change()` so it only writes history (no more
   mutating `completed_at` from inside the trigger).
2. Move status-history logging to AFTER INSERT and AFTER UPDATE triggers so
   the parent `tasks` row is committed and the FK is satisfiable.
3. Keep the `completed_at` stamping in a SEPARATE BEFORE UPDATE trigger so
   the value is in place before the row is written.

## Notes
- No data is deleted or renamed; functions are replaced in place.
- Triggers are dropped and recreated with the correct timing.
*/

-- History logging only. Runs AFTER the parent row is committed so the FK
-- task_status_history.task_id -> tasks.id is satisfiable.
CREATE OR REPLACE FUNCTION record_task_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO task_status_history (task_id, from_status, to_status, changed_by, changed_at)
    VALUES (NEW.id, NULL, COALESCE(NEW.status, 'Not Started'), NEW.user_id, now());
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO task_status_history (task_id, from_status, to_status, changed_by, changed_at)
    VALUES (NEW.id, OLD.status, NEW.status, NEW.user_id, now());
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION record_task_status_change() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION record_task_status_change() TO authenticated;

-- completed_at stamping, runs BEFORE UPDATE so the row is written with the
-- correct value.
CREATE OR REPLACE FUNCTION stamp_task_completed_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'Completed' AND OLD.status <> 'Completed' THEN
    NEW.completed_at := now();
  ELSIF NEW.status <> 'Completed' AND OLD.status = 'Completed' THEN
    NEW.completed_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION stamp_task_completed_at() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION stamp_task_completed_at() TO authenticated;

-- Re-attach triggers with correct timing.
DROP TRIGGER IF EXISTS trg_tasks_status_history_insert ON tasks;
CREATE TRIGGER trg_tasks_status_history_insert
  AFTER INSERT ON tasks
  FOR EACH ROW EXECUTE FUNCTION record_task_status_change();

DROP TRIGGER IF EXISTS trg_tasks_status_history_update ON tasks;
CREATE TRIGGER trg_tasks_status_history_update
  AFTER UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION record_task_status_change();

DROP TRIGGER IF EXISTS trg_tasks_completed_at ON tasks;
CREATE TRIGGER trg_tasks_completed_at
  BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION stamp_task_completed_at();
