/*
# Add default_company_id to profiles

1. Modified Table: `profiles`
- `default_company_id` (uuid, nullable) — links each employee profile to their primary parent company (`calendar_companies.id`), with `ON DELETE SET NULL`.

2. Notes
- Idempotent: safe to re-run (`ADD COLUMN IF NOT EXISTS`).
- Does not touch any shared database objects outside Calendar.
*/

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'calendar_companies'
  ) THEN
    ALTER TABLE public.profiles
      ADD COLUMN IF NOT EXISTS default_company_id uuid REFERENCES public.calendar_companies(id) ON DELETE SET NULL;
  ELSE
    ALTER TABLE public.profiles
      ADD COLUMN IF NOT EXISTS default_company_id uuid;
  END IF;
END $$;
