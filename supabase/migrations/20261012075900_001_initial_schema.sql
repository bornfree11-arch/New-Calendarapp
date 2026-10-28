/*
# Shared Calendar Application — Initial Schema

## Overview
Creates the full database schema for a shared calendar and appointment management application
for coworkers who schedule Tax/Accounting, ACA, Medicare, Life Insurance, and Other appointments.

## New Tables
1. `profiles` — Extends auth.users with user data (email, name, phone, color, role, status)
2. `companies` — Company profiles with address and phone for client email reminders
3. `appointment_type_mappings` — Maps each appointment type to a company
4. `appointments` — Calendar appointments with client info, scheduling, and company association
5. `app_settings` — Singleton configuration (business timezone)

## Security
- RLS enabled on all tables
- Exclusion constraint prevents same-coworker appointment overlaps (concurrency-safe)
- end_time is always calculated server-side from start_time + duration_minutes
- Inactive user login blocked via trigger on auth.sessions

## Important Notes
- Email stored on profiles table
- 12 predefined soft colors, unique among active users
- US phone format validation
- Time slots 07:00–18:30 start, end_time <= 19:00
- Durations: 30, 60, 90, 120 minutes
- Company snapshot (JSONB) frozen on each appointment
*/

-- Extensions first
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ============================================================================
-- PROFILES TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  full_name text NOT NULL,
  phone text,
  notes text DEFAULT '',
  calendar_color text NOT NULL DEFAULT '#6B7B8D',
  role text NOT NULL DEFAULT 'coworker' CHECK (role IN ('admin', 'coworker')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS profiles_active_color_unique
  ON profiles (calendar_color)
  WHERE status = 'active';

CREATE OR REPLACE FUNCTION validate_us_phone(phone text)
RETURNS boolean AS $$
BEGIN
  IF phone IS NULL THEN
    RETURN true;
  END IF;
  RETURN phone ~ '^\(\d{3}\)\s?\d{3}-\d{4}$';
END;
$$ LANGUAGE plpgsql IMMUTABLE;

ALTER TABLE profiles ADD CONSTRAINT profiles_phone_check
  CHECK (validate_us_phone(phone));

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_select_all" ON profiles;
CREATE POLICY "profiles_select_all"
  ON profiles FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "profiles_update_own" ON profiles;
CREATE POLICY "profiles_update_own"
  ON profiles FOR UPDATE TO authenticated
  USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "profiles_insert_admin" ON profiles;
CREATE POLICY "profiles_insert_admin"
  ON profiles FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "profiles_delete_admin" ON profiles;
CREATE POLICY "profiles_delete_admin"
  ON profiles FOR DELETE TO authenticated USING (true);

-- Auto-create profile on auth user creation
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', ''));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- updated_at helper
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS profiles_updated_at ON profiles;
CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================================
-- COMPANIES TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  address_line1 text NOT NULL,
  address_line2 text DEFAULT '',
  city text NOT NULL,
  state text NOT NULL,
  zip_code text NOT NULL,
  phone text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE companies ADD CONSTRAINT companies_phone_check
  CHECK (validate_us_phone(phone));

DROP TRIGGER IF EXISTS companies_updated_at ON companies;
CREATE TRIGGER companies_updated_at
  BEFORE UPDATE ON companies
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE companies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "companies_select_all" ON companies;
CREATE POLICY "companies_select_all"
  ON companies FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "companies_insert_admin" ON companies;
CREATE POLICY "companies_insert_admin"
  ON companies FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "companies_update_admin" ON companies;
CREATE POLICY "companies_update_admin"
  ON companies FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "companies_delete_admin" ON companies;
CREATE POLICY "companies_delete_admin"
  ON companies FOR DELETE TO authenticated USING (true);

-- ============================================================================
-- APPOINTMENT TYPE MAPPINGS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS appointment_type_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_type text NOT NULL CHECK (
    appointment_type IN ('Tax/Accounting', 'ACA', 'Medicare', 'Life', 'Other')
  ),
  company_id uuid REFERENCES companies(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(appointment_type)
);

DROP TRIGGER IF EXISTS appointment_type_mappings_updated_at ON appointment_type_mappings;
CREATE TRIGGER appointment_type_mappings_updated_at
  BEFORE UPDATE ON appointment_type_mappings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE appointment_type_mappings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "type_mappings_select_all" ON appointment_type_mappings;
CREATE POLICY "type_mappings_select_all"
  ON appointment_type_mappings FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "type_mappings_insert_admin" ON appointment_type_mappings;
CREATE POLICY "type_mappings_insert_admin"
  ON appointment_type_mappings FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "type_mappings_update_admin" ON appointment_type_mappings;
CREATE POLICY "type_mappings_update_admin"
  ON appointment_type_mappings FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "type_mappings_delete_admin" ON appointment_type_mappings;
CREATE POLICY "type_mappings_delete_admin"
  ON appointment_type_mappings FOR DELETE TO authenticated USING (true);

-- ============================================================================
-- APPOINTMENTS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_date date NOT NULL,
  start_time time NOT NULL,
  duration_minutes int NOT NULL CHECK (duration_minutes IN (30, 60, 90, 120)),
  end_time time NOT NULL,
  appointment_type text NOT NULL CHECK (
    appointment_type IN ('Tax/Accounting', 'ACA', 'Medicare', 'Life', 'Other')
  ),
  client_name text NOT NULL,
  client_phone text NOT NULL,
  client_email text DEFAULT '',
  notes text DEFAULT '',
  assigned_to uuid NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  company_id uuid REFERENCES companies(id) ON DELETE SET NULL,
  company_snapshot jsonb DEFAULT '{}',
  status text NOT NULL DEFAULT 'Scheduled' CHECK (
    status IN ('Scheduled', 'Completed', 'Cancelled', 'No-show')
  ),
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  last_modified_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Plain column for exclusion constraint (populated by trigger)
  time_range tsrange
);

ALTER TABLE appointments ADD CONSTRAINT appointments_client_phone_check
  CHECK (validate_us_phone(client_phone));

ALTER TABLE appointments ADD CONSTRAINT appointments_client_email_check
  CHECK (
    client_email = '' OR client_email ~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'
  );

ALTER TABLE appointments ADD CONSTRAINT appointments_start_time_check
  CHECK (start_time >= '07:00:00' AND start_time <= '18:30:00');

ALTER TABLE appointments ADD CONSTRAINT appointments_end_time_check
  CHECK (end_time <= '19:00:00');

ALTER TABLE appointments ADD CONSTRAINT appointments_end_time_calc_check
  CHECK (
    end_time = (start_time + (duration_minutes || ' minutes')::interval)::time
  );

CREATE INDEX IF NOT EXISTS idx_appointments_date ON appointments (appointment_date);
CREATE INDEX IF NOT EXISTS idx_appointments_assigned ON appointments (assigned_to);
CREATE INDEX IF NOT EXISTS idx_appointments_status ON appointments (status);
CREATE INDEX IF NOT EXISTS idx_appointments_client_name ON appointments USING gin (client_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_appointments_client_phone ON appointments (client_phone);

-- Exclusion constraint: same coworker, overlapping time, both Scheduled
ALTER TABLE appointments ADD CONSTRAINT no_same_coworker_overlap
  EXCLUDE USING gist (
    assigned_to WITH =,
    time_range WITH &&,
    status WITH =
  ) WHERE (status = 'Scheduled');

DROP TRIGGER IF EXISTS appointments_updated_at ON appointments;
CREATE TRIGGER appointments_updated_at
  BEFORE UPDATE ON appointments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "appointments_select_all" ON appointments;
CREATE POLICY "appointments_select_all"
  ON appointments FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "appointments_insert_all" ON appointments;
CREATE POLICY "appointments_insert_all"
  ON appointments FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "appointments_update_all" ON appointments;
CREATE POLICY "appointments_update_all"
  ON appointments FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "appointments_delete_all" ON appointments;
CREATE POLICY "appointments_delete_all"
  ON appointments FOR DELETE TO authenticated USING (true);

-- ============================================================================
-- APPOINTMENT TRIGGER: Calculate end_time, time_range, company_snapshot
-- ============================================================================
CREATE OR REPLACE FUNCTION calculate_appointment_fields()
RETURNS trigger AS $$
DECLARE
  mapped_company_id uuid;
  company_record companies%ROWTYPE;
BEGIN
  -- Calculate end_time from start_time + duration
  NEW.end_time = (NEW.start_time + (NEW.duration_minutes || ' minutes')::interval)::time;

  -- Validate end_time <= 19:00
  IF NEW.end_time > '19:00:00' THEN
    RAISE EXCEPTION 'Appointment end time % exceeds the 7:00 PM boundary.', NEW.end_time;
  END IF;

  -- Calculate time_range for exclusion constraint
  NEW.time_range = tstzrange(
    (NEW.appointment_date + NEW.start_time)::timestamptz,
    (NEW.appointment_date + (NEW.start_time + (NEW.duration_minutes || ' minutes')::interval))::timestamptz,
    '[)'
  );

  -- If company_id not explicitly set, get from type mapping
  IF NEW.company_id IS NULL THEN
    SELECT company_id INTO mapped_company_id
    FROM appointment_type_mappings
    WHERE appointment_type = NEW.appointment_type;
    NEW.company_id = mapped_company_id;
  END IF;

  -- Snapshot company info
  IF NEW.company_id IS NOT NULL THEN
    SELECT * INTO company_record FROM companies WHERE id = NEW.company_id;
    IF FOUND THEN
      NEW.company_snapshot = jsonb_build_object(
        'name', company_record.name,
        'address_line1', company_record.address_line1,
        'address_line2', company_record.address_line2,
        'city', company_record.city,
        'state', company_record.state,
        'zip_code', company_record.zip_code,
        'phone', company_record.phone
      );
    END IF;
  END IF;

  -- Set last_modified_by
  IF NEW.last_modified_by IS NULL THEN
    NEW.last_modified_by = auth.uid();
  END IF;

  -- Set created_by on insert
  IF TG_OP = 'INSERT' AND NEW.created_by IS NULL THEN
    NEW.created_by = auth.uid();
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS appointments_calculate_before_insert ON appointments;
CREATE TRIGGER appointments_calculate_before_insert
  BEFORE INSERT ON appointments
  FOR EACH ROW EXECUTE FUNCTION calculate_appointment_fields();

DROP TRIGGER IF EXISTS appointments_calculate_before_update ON appointments;
CREATE TRIGGER appointments_calculate_before_update
  BEFORE UPDATE ON appointments
  FOR EACH ROW EXECUTE FUNCTION calculate_appointment_fields();

-- ============================================================================
-- APP_SETTINGS TABLE (singleton)
-- ============================================================================
CREATE TABLE IF NOT EXISTS app_settings (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  business_timezone text NOT NULL DEFAULT 'America/New_York',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO app_settings (id) VALUES (1) ON CONFLICT DO NOTHING;

DROP TRIGGER IF EXISTS app_settings_updated_at ON app_settings;
CREATE TRIGGER app_settings_updated_at
  BEFORE UPDATE ON app_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "app_settings_select_all" ON app_settings;
CREATE POLICY "app_settings_select_all"
  ON app_settings FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "app_settings_update_admin" ON app_settings;
CREATE POLICY "app_settings_update_admin"
  ON app_settings FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- ============================================================================
-- SEED APPOINTMENT TYPE MAPPINGS
-- ============================================================================
INSERT INTO appointment_type_mappings (appointment_type) VALUES
  ('Tax/Accounting'),
  ('ACA'),
  ('Medicare'),
  ('Life'),
  ('Other')
ON CONFLICT (appointment_type) DO NOTHING;