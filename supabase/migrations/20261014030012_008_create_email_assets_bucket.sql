/*
# Create public storage bucket "email-assets"

## Purpose
Create a public storage bucket named "email-assets" to hold company logo images
used in transactional email templates. The bucket is public so email clients can
load the logos without authentication.

## Changes
1. Insert a row into `storage.buckets` for "email-assets" with public=true.
2. Add public read policies on `storage.objects` for the email-assets bucket so
   anyone (anon + authenticated) can read objects.
3. Add write policies so authenticated users can upload/overwrite logo files.
*/

-- 1. Create the bucket (idempotent)
INSERT INTO storage.buckets (id, name, public)
VALUES ('email-assets', 'email-assets', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- 2. Public read access for email-assets bucket
DROP POLICY IF EXISTS "public_read_email_assets" ON storage.objects;
CREATE POLICY "public_read_email_assets"
ON storage.objects FOR SELECT
TO anon, authenticated
USING (bucket_id = 'email-assets');

-- 3. Authenticated users can upload to email-assets bucket
DROP POLICY IF EXISTS "auth_upload_email_assets" ON storage.objects;
CREATE POLICY "auth_upload_email_assets"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'email-assets');

-- 4. Authenticated users can update/overwrite files in email-assets bucket
DROP POLICY IF EXISTS "auth_update_email_assets" ON storage.objects;
CREATE POLICY "auth_update_email_assets"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'email-assets')
WITH CHECK (bucket_id = 'email-assets');

-- 5. Authenticated users can delete files in email-assets bucket
DROP POLICY IF EXISTS "auth_delete_email_assets" ON storage.objects;
CREATE POLICY "auth_delete_email_assets"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'email-assets');
