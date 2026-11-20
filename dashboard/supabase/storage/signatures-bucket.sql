-- Private bucket for the Director's signature and stamp images (formerly dashboard/assets/signature/).
-- These images can be used to forge official RSIA Melinda letters, so they never live in Git.
-- Not a migration: CI's db-test.sh runs supabase/migrations on a plain Postgres without the storage schema.
-- Apply once in the Supabase SQL Editor, or create the bucket through the Storage API with the service key.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'signatures',
  'signatures',
  false,
  10485760, -- 10 MB; the largest file today is 1.8 MB
  array['image/png', 'text/plain']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- No storage.objects policies on purpose: only the service key (server side) can read or write;
-- anon and authenticated roles have no path in.
