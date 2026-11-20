-- Private bucket for the Director's Order obat uploads (PDF / CSV / XLSX sheets read by lib/pharmacy/order-obat-*).
-- Not a migration: CI's db-test.sh runs supabase/migrations on a plain Postgres without the storage schema.
-- Apply once in the Supabase SQL Editor (the agent has no database access).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'order-obat',
  'order-obat',
  false,
  15728640, -- 15 MB, matching ORDER_OBAT_MAX_BYTES in lib/pharmacy/order-obat-storage.ts
  array[
    'application/pdf',
    'text/csv',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/octet-stream'
  ]
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- No storage.objects policies on purpose: only the service key (server side, after a Director session check)
-- can read or write; anon and authenticated roles have no path in.
