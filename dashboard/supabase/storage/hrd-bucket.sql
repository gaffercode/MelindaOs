-- Private bucket for the staff and officials directory read by /hrd (lib/hrd/hrd-directory.ts).
-- Holds staff names and officials' personal phone numbers, so the list never lives in Git; the public tree carries
-- only the fictional sample in data/synthetic/hrd-directory.json.
-- Not a migration: CI's db-test.sh runs supabase/migrations on a plain Postgres without the storage schema.
-- Apply once in the Supabase SQL Editor, or create the bucket through the Storage API with the service key.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('hrd', 'hrd', false, 1048576, array['application/json'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- No storage.objects policies on purpose: only the service key (server side, after the page permission check)
-- can read or write; anon and authenticated roles have no path in.
