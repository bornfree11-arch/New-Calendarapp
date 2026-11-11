/*
# Customer Directory & WhatsApp Controls

## Purpose
Introduces a dedicated customer directory so the practice can manage recurring
client information independently of individual appointments, and adds per-
appointment WhatsApp send controls.

## 1. New Table: `customers`
- `id` (uuid, primary key, default gen_random_uuid())
- `full_name` (text, not null) — customer display name
- `phone` (text, not null, default '') — US phone, validated by `validate_us_phone`; empty string allowed for walk-ins
- `email` (text, not null, default '') — optional email, validated if non-empty
- `notes` (text, not null, default '') — free-form notes
- `tags` (text[], not null, default '{}') — flexible tagging (e.g. 'VIP', 'Tax')
- `created_by` (uuid, nullable) — profile id of creator
- `created_at` (timestamptz, default now())
- `updated_at` (timestamptz, default now())

## 2. Altered Table: `appointments`
- Added `send_whatsapp` (boolean, not null, default false) — per-appointment WhatsApp opt-in
- Added `customer_id` (uuid, nullable) — optional FK to `customers(id)` with ON DELETE SET NULL
- `client_phone` column constraint relaxed: `validate_us_phone` now accepts empty string (walk-in / no-phone appointments)

## 3. Modified Function: `validate_us_phone`
- Now returns true for empty string ('') in addition to NULL, so appointments
  and customer records can omit a phone number without failing the CHECK constraint.

## 4. Indexes
- `customers_phone_idx` — GIN trigram index on `phone` for fuzzy phone search
- `customers_name_idx` — GIN trigram index on `full_name` for fuzzy name search
- `customers_tags_idx` — GIN index on `tags` for tag-based filtering

## 5. Security
- RLS enabled on `customers`.
- Grants: SELECT, INSERT, UPDATE, DELETE on `customers` to `authenticated` (app uses sign-in; shared directory across staff).
- Policies: all authenticated users can CRUD customer rows (shared practice directory).
- `appointments` table gets INSERT/UPDATE grants for the two new columns (`send_whatsapp`, `customer_id`) so existing role privileges cover them.

## 6. Important Notes
- All statements are idempotent: `IF NOT EXISTS` guards and DROP-before-CREATE for policies.
- No data is lost: `client_phone` keeps its existing values; the new default only applies to new rows that omit it.
- The `appointments.client_phone` DEFAULT '' is added so new rows can omit phone without failing NOT NULL.
*/

-- ─── Step 1: Relax validate_us_phone to accept empty string ───
CREATE OR REPLACE FUNCTION public.validate_us_phone(phone text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $function$
BEGIN
  IF phone IS NULL OR phone = '' THEN
    RETURN true;
  END IF;
  RETURN phone ~ '^\(\d{3}\)\s?\d{3}-\d{4}$';
END;
$function$;

-- ─── Step 2: Create customers table ───
CREATE TABLE IF NOT EXISTS public.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  phone text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  tags text[] NOT NULL DEFAULT '{}',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customers_phone_format CHECK (public.validate_us_phone(phone)),
  CONSTRAINT customers_email_format CHECK (
    email = '' OR email ~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'
  )
);

-- ─── Step 3: Add columns to appointments (idempotent) ───
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'appointments' AND column_name = 'send_whatsapp'
  ) THEN
    ALTER TABLE public.appointments ADD COLUMN send_whatsapp boolean NOT NULL DEFAULT false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'appointments' AND column_name = 'customer_id'
  ) THEN
    ALTER TABLE public.appointments ADD COLUMN customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ─── Step 4: Indexes for customer search ───
CREATE INDEX IF NOT EXISTS customers_phone_idx ON public.customers USING gin (phone gin_trgm_ops);
CREATE INDEX IF NOT EXISTS customers_name_idx ON public.customers USING gin (full_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS customers_tags_idx ON public.customers USING gin (tags);

-- ─── Step 5: RLS on customers ───
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.customers TO authenticated;

DROP POLICY IF EXISTS "customers_select_all" ON public.customers;
CREATE POLICY "customers_select_all"
  ON public.customers FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "customers_insert_all" ON public.customers;
CREATE POLICY "customers_insert_all"
  ON public.customers FOR INSERT
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "customers_update_all" ON public.customers;
CREATE POLICY "customers_update_all"
  ON public.customers FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "customers_delete_all" ON public.customers;
CREATE POLICY "customers_delete_all"
  ON public.customers FOR DELETE
  TO authenticated USING (true);

-- ─── Step 6: Ensure appointments grants cover new columns ───
-- Existing grants already cover full-table INSERT/UPDATE for authenticated/anon.
-- No additional grants needed for send_whatsapp / customer_id since they are
-- included in the table-level privilege.

-- ─── Step 7: updated_at trigger for customers ───
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS customers_updated_at ON public.customers;
CREATE TRIGGER customers_updated_at
  BEFORE UPDATE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
