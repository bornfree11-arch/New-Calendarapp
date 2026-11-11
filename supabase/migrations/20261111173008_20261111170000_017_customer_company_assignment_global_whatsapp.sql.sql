/*
# Add company assignment, employee assignment, global flag, and WhatsApp toggle to customers

1. New Columns on `customers`
- `company_id` (uuid, nullable) — links a customer to a specific company. REFERENCES `companies(id) ON DELETE SET NULL` so deleting a company un-links (but does not delete) its customers.
- `assigned_user_id` (uuid, nullable) — the employee primarily responsible for this customer. REFERENCES `profiles(id) ON DELETE SET NULL` so deleting an employee un-links (but does not delete) the customer.
- `is_global` (boolean, NOT NULL, default false) — when true the customer is shared across all companies (not tied to a single company_id for filtering purposes).
- `send_whatsapp` (boolean, NOT NULL, default true) — controls whether WhatsApp/SMS reminders are sent to this customer.

2. Modified Tables
- `customers` — four new columns added via ADD COLUMN IF NOT EXISTS (idempotent). Existing rows get `is_global = false` and `send_whatsapp = true` defaults.

3. Security
- No new tables created. RLS on `customers` remains enabled.
- Existing CRUD grants and policies for `authenticated` role continue to cover the new columns (table-level grant).
- No policy changes needed — the new columns are read/written under the same ownership rules already in place.

4. Important Notes
- This migration is idempotent: re-running it is safe because every ALTER uses IF NOT EXISTS.
- No data is lost: `tags` column is left in place (the frontend will stop using it but the DB column remains).
*/

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_user_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_global boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS send_whatsapp boolean NOT NULL DEFAULT true;
