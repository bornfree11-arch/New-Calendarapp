/*
# Add preferred_language to customers table

## Purpose
Adds `preferred_language` ('es' | 'en', default 'es') to the `customers` table to support bilingual communication and segmentation (Spanish/English).

## 1. New Column on `customers`
- `preferred_language` (text, NOT NULL, default 'es') — preferred customer language ('es' or 'en')

## 2. Security & Idempotency
- Uses ADD COLUMN IF NOT EXISTS.
- Existing RLS policies and table grants cover the new column automatically.
*/

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS preferred_language text NOT NULL DEFAULT 'es';
