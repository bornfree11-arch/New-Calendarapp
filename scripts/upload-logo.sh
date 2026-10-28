#!/bin/bash
#
# Upload a logo file to the "email-assets" public storage bucket.
#
# Usage:
#   bash scripts/upload-logo.sh <path-to-logo-file> <filename-in-bucket>
#
# Example:
#   bash scripts/upload-logo.sh ./stress-free-taxes-logo.png stress-free-taxes-logo.png
#
# The file will be publicly accessible at:
#   https://firmdngjvcyhfnhaaafq.supabase.co/storage/v1/object/public/email-assets/<filename-in-bucket>
#

set -euo pipefail

SUPABASE_URL="https://firmdngjvcyhfnhaaafq.supabase.co"
ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZpcm1kbmdqdmN5aGZuaGFhYWZxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE3ODQyMDQsImV4cCI6MjEwNzM2MDIwNH0.nozz0ipoBjEGGN-FmGL2FHuF4-Oun0EGLaPTorwLoFg"

if [ "$#" -lt 1 ] || [ "$#" -gt 2 ]; then
  echo "Usage: bash scripts/upload-logo.sh <path-to-logo-file> [filename-in-bucket]"
  echo ""
  echo "Example:"
  echo "  bash scripts/upload-logo.sh ./stress-free-taxes-logo.png stress-free-taxes-logo.png"
  exit 1
fi

LOCAL_FILE="$1"
BUCKET_FILENAME="${2:-$(basename "$LOCAL_FILE")}"

if [ ! -f "$LOCAL_FILE" ]; then
  echo "Error: File not found: $LOCAL_FILE"
  exit 1
fi

# Detect content type from file extension
EXT="${LOCAL_FILE##*.}"
case "$EXT" in
  png)  CONTENT_TYPE="image/png" ;;
  jpg|jpeg) CONTENT_TYPE="image/jpeg" ;;
  gif)  CONTENT_TYPE="image/gif" ;;
  svg)  CONTENT_TYPE="image/svg+xml" ;;
  webp) CONTENT_TYPE="image/webp" ;;
  *)    CONTENT_TYPE="application/octet-stream" ;;
esac

UPLOAD_URL="${SUPABASE_URL}/storage/v1/object/email-assets/${BUCKET_FILENAME}"
PUBLIC_URL="${SUPABASE_URL}/storage/v1/object/public/email-assets/${BUCKET_FILENAME}"

echo "Uploading: $LOCAL_FILE -> email-assets/$BUCKET_FILENAME"
echo "Content-Type: $CONTENT_TYPE"
echo ""

RESPONSE=$(curl -s -w "\n%{http_code}" \
  -X POST "$UPLOAD_URL" \
  -H "Authorization: Bearer ${ANON_KEY}" \
  -H "Content-Type: ${CONTENT_TYPE}" \
  -T "$LOCAL_FILE")

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "200" ]; then
  echo "Upload successful!"
  echo ""
  echo "Your logo is now publicly available at:"
  echo "  $PUBLIC_URL"
  echo ""
  echo "You can use this URL in your email templates or <img> tags."
else
  echo "Upload failed (HTTP $HTTP_CODE):"
  echo "$BODY"
  exit 1
fi
