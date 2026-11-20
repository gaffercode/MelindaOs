-- Private bucket for the BPJS 2026 credentialing files served by /api/director/kredensial/<path>.
-- Not a migration: CI's db-test.sh runs supabase/migrations on a plain Postgres without the storage schema.
-- Apply once in the Supabase SQL Editor (or `scripts/kredensial-upload.mjs --create-bucket`, which uses the Storage API).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'kredensial',
  'kredensial',
  false,
  52428800, -- 50 MB; the largest file today is 18.5 MB
  array['application/pdf', 'image/jpeg', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- No storage.objects policies on purpose: only the service key (server side, after a Director session check)
-- can read or write; anon and authenticated roles have no path in.
