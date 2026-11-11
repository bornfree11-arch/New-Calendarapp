/*
# Add mailing address and birthday fields to customers

## Purpose
Extends the customer directory so each customer record can optionally store a
mailing address and a birthday, enabling richer customer profiles and future
birthday-based outreach.

## 1. New Columns on `customers`
- `address_line1` (text, NOT NULL, default '') — first line of the mailing address
- `address_line2` (text, NOT NULL, default '') — second line (apartment, suite, etc.)
- `city` (text, NOT NULL, default '') — city portion of the mailing address
- `state` (text, NOT NULL, default '') — state portion of the mailing address
- `zip_code` (text, NOT NULL, default '') — ZIP / postal code
- `date_of_birth` (date, nullable) — customer birthday (date only, no time)

All address columns default to empty string so existing rows and inserts that
omit them continue to work without changes. `date_of_birth` is nullable because
a birthday is not always known.

## 2. Security
- No new tables created. RLS on `customers` remains enabled.
- Existing CRUD grants and policies for the `authenticated` role continue to
  cover the new columns (table-level grant covers all columns).
- No policy changes needed.

## 3. Important Notes
- This migration is idempotent: re-running is safe because every ALTER uses
  IF NOT EXISTS.
- No data is lost: existing rows pick up the default empty strings for the new
  address columns and NULL for date_of_birth.
*/

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS address_line1 text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS address_line2 text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS city text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS state text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS zip_code text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS date_of_birth date;