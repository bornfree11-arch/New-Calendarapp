/*
# Fix task-save failure: SECURITY DEFINER trigger cannot see auth.uid()

## Root cause
`record_task_status_change()` is SECURITY DEFINER (owned by postgres). Inside a
SECURITY DEFINER function, `auth.uid()` returns NULL because the request JWT is
not consulted in that execution context. The BEFORE INSERT trigger on `tasks`
called this function, which tried:

    INSERT INTO task_status_history (..., changed_by, ...)
    VALUES (..., auth.uid(), ...);

`changed_by` is `uuid NOT NULL`, so the NULL violated the constraint and
aborted the parent `tasks` INSERT — surfacing in the app as
"Failed to save task."

## Fix
1. In the INSERT branch, use `NEW.user_id` as the actor. The task row carries
   the owner (`user_id` defaults to `auth.uid()` from the session, set by the
   row-level default BEFORE the trigger reads NEW). This is the same value
   `auth.uid()` would have returned had it been available.
2. In the UPDATE branch, keep using `auth.uid()`. UPDATE triggers on a plain
   (non-SECURITY-DEFINER-needed) path — but to be safe and consistent, use
   `NEW.user_id` for the actor as well. The owner cannot change (UPDATE policy
   enforces user_id = auth.uid()), so `NEW.user_id` is the acting user.
3. Revoke/GRANT unchanged; function stays SECURITY DEFINER so it can write to
   task_status_history, which the authenticated role only has INSERT on via
   policy.

## Safety
- No data is deleted or renamed.
- No column types change.
- Function is replaced in place; triggers re-attached to existing definitions.
*/

CREATE OR REPLACE FUNCTION record_task_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- On INSERT: log the creation with from_status NULL.
  -- Use NEW.user_id as the actor: auth.uid() is NULL inside SECURITY DEFINER,
  -- but the tasks.user_id column defaults to auth.uid() at INSERT time, so
  -- NEW.user_id is the signed-in user who created the row.
  IF TG_OP = 'INSERT' THEN
    INSERT INTO task_status_history (task_id, from_status, to_status, changed_by, changed_at)
    VALUES (NEW.id, NULL, COALESCE(NEW.status, 'Not Started'), NEW.user_id, now());
    RETURN NEW;
  END IF;

  -- On UPDATE: only log when the status actually changed.
  -- NEW.user_id is the row owner; the UPDATE RLS policy guarantees the caller
  -- is that owner (auth.uid() = user_id), so it is the acting user.
  IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO task_status_history (task_id, from_status, to_status, changed_by, changed_at)
    VALUES (NEW.id, OLD.status, NEW.status, NEW.user_id, now());

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

-- Triggers are already attached; no need to drop/recreate.
