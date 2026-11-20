-- Order obat: files the Director uploads on /order-obat (CSV, PDF, XLSX) live in the private Storage bucket
-- `order-obat`; this table keeps their metadata and, for CSV, the parsed rows. Only Dash (server-only,
-- authenticated as the Director) calls the RPC. Nothing here approves, orders, or pays anything.
begin;

create table melinda_private.pharmacy_orders (
  id bigint generated always as identity primary key,
  uploaded_at timestamptz not null default clock_timestamp(),
  uploaded_by text not null check (length(uploaded_by) between 1 and 80),
  file_name text not null check (length(file_name) between 1 and 160),
  content_type text not null check (length(content_type) between 1 and 120),
  byte_size integer not null check (byte_size between 1 and 16777216),
  sha256 text not null unique check (sha256 ~ '^[0-9a-f]{64}$'),
  storage_path text not null unique check (length(storage_path) between 1 and 240),
  kind text not null check (kind in ('csv','pdf','xlsx','other')),
  parsed jsonb,
  note text check (note is null or length(note) <= 280)
);
create index pharmacy_orders_recent on melinda_private.pharmacy_orders (uploaded_at desc);
alter table melinda_private.pharmacy_orders enable row level security;
revoke all on melinda_private.pharmacy_orders from public, anon, authenticated, service_role;

-- The Director's decision on a submission file: accepted or rejected, one row per file. `order_key` is
-- `upload:<id>` for an uploaded file or `builtin:<id>` for a sheet that ships with the dashboard.
-- Deleting the row withdraws the decision. This is a decision about the file, not an order or a payment.
create table melinda_private.pharmacy_order_decisions (
  order_key text primary key check (order_key ~ '^(upload:[0-9]{1,12}|builtin:[a-z0-9-]{1,80})$'),
  decision text not null check (decision in ('diterima','ditolak')),
  note text check (note is null or length(note) <= 280),
  decided_by text not null check (length(decided_by) between 1 and 80),
  decided_at timestamptz not null default clock_timestamp()
);
alter table melinda_private.pharmacy_order_decisions enable row level security;
revoke all on melinda_private.pharmacy_order_decisions from public, anon, authenticated, service_role;

create function public.melinda_pharmacy_orders(command text, args jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  item melinda_private.pharmacy_orders%rowtype;
  verdict melinda_private.pharmacy_order_decisions%rowtype;
  result jsonb;
  decisions jsonb;
  replayed boolean := false;
begin
  if command = 'decide' then
    if args->>'decision' is null then
      delete from melinda_private.pharmacy_order_decisions where order_key = args->>'orderKey';
      return jsonb_build_object('decision', null);
    end if;
    if (args->>'orderKey') like 'upload:%' and not exists (select 1 from melinda_private.pharmacy_orders where id = substr(args->>'orderKey', 8)::bigint) then
      return jsonb_build_object('errorCode', 'not_found');
    end if;
    insert into melinda_private.pharmacy_order_decisions (order_key, decision, note, decided_by)
    values (args->>'orderKey', args->>'decision', nullif(args->>'note', ''), args->>'decidedBy')
    on conflict (order_key) do update set decision = excluded.decision, note = excluded.note, decided_by = excluded.decided_by, decided_at = clock_timestamp()
    returning * into verdict;
    return jsonb_build_object('decision', jsonb_build_object('orderKey', verdict.order_key, 'decision', verdict.decision, 'note', verdict.note,
      'decidedBy', verdict.decided_by, 'decidedAt', verdict.decided_at));
  end if;
  if command = 'create' then
    select * into item from melinda_private.pharmacy_orders where sha256 = args->>'sha256';
    if found then
      replayed := true;
    else
      insert into melinda_private.pharmacy_orders (uploaded_by, file_name, content_type, byte_size, sha256, storage_path, kind, parsed, note)
      values (args->>'uploadedBy', args->>'fileName', args->>'contentType', (args->>'byteSize')::integer, args->>'sha256', args->>'storagePath', args->>'kind', args->'parsed', nullif(args->>'note', ''))
      returning * into item;
    end if;
  elsif command = 'read' then
    select * into item from melinda_private.pharmacy_orders where id = (args->>'id')::bigint;
    if not found then return jsonb_build_object('errorCode', 'not_found'); end if;
  elsif command = 'list' then
    select jsonb_agg(jsonb_build_object('id', o.id, 'uploadedAt', o.uploaded_at, 'uploadedBy', o.uploaded_by, 'fileName', o.file_name,
      'contentType', o.content_type, 'byteSize', o.byte_size, 'sha256', o.sha256, 'kind', o.kind, 'note', o.note, 'parsedFormat', o.parsed->>'format')
      order by o.uploaded_at desc, o.id desc)
      into result
      from (select * from melinda_private.pharmacy_orders order by uploaded_at desc, id desc limit least(greatest(coalesce((args->>'limit')::integer, 50), 1), 200)) o;
    select jsonb_object_agg(d.order_key, jsonb_build_object('orderKey', d.order_key, 'decision', d.decision, 'note', d.note,
      'decidedBy', d.decided_by, 'decidedAt', d.decided_at))
      into decisions from melinda_private.pharmacy_order_decisions d;
    return jsonb_build_object('orders', coalesce(result, '[]'::jsonb), 'decisions', coalesce(decisions, '{}'::jsonb));
  else
    return jsonb_build_object('errorCode', 'invalid_command');
  end if;
  return jsonb_build_object('order', jsonb_build_object('id', item.id, 'uploadedAt', item.uploaded_at, 'uploadedBy', item.uploaded_by,
    'fileName', item.file_name, 'contentType', item.content_type, 'byteSize', item.byte_size, 'sha256', item.sha256,
    'storagePath', item.storage_path, 'kind', item.kind, 'parsed', item.parsed, 'note', item.note), 'replayed', replayed);
end;
$$;
revoke all on function public.melinda_pharmacy_orders(text, jsonb) from public, anon, authenticated;
grant execute on function public.melinda_pharmacy_orders(text, jsonb) to service_role;
comment on function public.melinda_pharmacy_orders(text, jsonb) is 'Server-only metadata of Order obat uploads (bucket order-obat). Never expose the Supabase secret key to a browser.';

-- The private bucket exists only on Supabase (CI applies these migrations to a plain PostgreSQL without a storage schema).
do $$ begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('order-obat', 'order-obat', false, 16777216,
      array['text/csv','application/pdf','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-excel','application/octet-stream'])
    on conflict (id) do nothing;
  end if;
end $$;

commit;
