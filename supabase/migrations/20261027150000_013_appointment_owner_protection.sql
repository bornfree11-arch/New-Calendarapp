-- Step 1: Enable Row-Level Security on appointments if not already explicitly active
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;

-- Step 2: Drop existing wide-open policies for updates if they exist
DROP POLICY IF EXISTS "Allow all authenticated operations" ON public.appointments;
DROP POLICY IF EXISTS "Allow user updates" ON public.appointments;
DROP POLICY IF EXISTS "Appointments read access" ON public.appointments;
DROP POLICY IF EXISTS "Appointments insert access" ON public.appointments;
DROP POLICY IF EXISTS "Appointments delete access" ON public.appointments;
DROP POLICY IF EXISTS "Appointments update restriction" ON public.appointments;

-- Step 3: Implement specific CRUD boundary lines
-- Policy A: Allow any authenticated user to view appointments
CREATE POLICY "Appointments read access" ON public.appointments
    FOR SELECT TO authenticated USING (true);

-- Policy B: Allow any coworker or admin to create/insert an appointment
CREATE POLICY "Appointments insert access" ON public.appointments
    FOR INSERT TO authenticated WITH CHECK (true);

-- Policy C: Allow any authenticated user to delete if needed
CREATE POLICY "Appointments delete access" ON public.appointments
    FOR DELETE TO authenticated USING (true);

-- Policy D: Strict rule for modifications (Updates)
-- Enforces that either the user is an admin OR the user is the current owner (assigned_to) of the record.
CREATE POLICY "Appointments update restriction" ON public.appointments
    FOR UPDATE TO authenticated
    USING (
        (auth.jwt() -> 'user_metadata' ->> 'role' = 'administrator') OR
        (assigned_to = auth.uid())
    )
    WITH CHECK (
        -- If a non-admin is trying to switch the assigned_to (ownership) to someone else, reject it
        CASE 
            WHEN (auth.jwt() -> 'user_metadata' ->> 'role' = 'administrator') THEN true
            ELSE (assigned_to = auth.uid()) -- Non-admins must keep themselves as the owner
        END
    );
