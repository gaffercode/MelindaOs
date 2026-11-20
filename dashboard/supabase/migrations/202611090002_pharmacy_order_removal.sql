-- Order obat: the Director can remove a submission file. An upload loses its row (the server deletes the
-- object); a sheet that ships with the dashboard is marked removed here and stays out of the list.
-- Removing clears the decision too. Nothing here orders or pays.
begin;

create table melinda_private.pharmacy_order_removed (
  order_key text primary key check (order_key ~ '^builtin:[a-z0-9-]{1,80}$'),
  removed_by text not null check (length(removed_by) between 1 and 80),
  removed_at timestamptz not null default clock_timestamp()
);
alter table melinda_private.pharmacy_order_removed enable row level security;
revoke all on melinda_private.pharmacy_order_removed from public, anon, authenticated, service_role;

create or replace function public.melinda_pharmacy_orders(command text, args jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  item melinda_private.pharmacy_orders%rowtype;
  verdict melinda_private.pharmacy_order_decisions%rowtype;
  result jsonb;
  decisions jsonb;
  removed jsonb;
  replayed boolean := false;
begin
  if command = 'remove' then
    delete from melinda_private.pharmacy_order_decisions where order_key = args->>'orderKey';
    if (args->>'orderKey') like 'builtin:%' then
      insert into melinda_private.pharmacy_order_removed (order_key, removed_by) values (args->>'orderKey', args->>'removedBy')
      on conflict (order_key) do nothing;
      return jsonb_build_object('removed', args->>'orderKey', 'storagePath', null);
    end if;
    delete from melinda_private.pharmacy_orders where id = substr(args->>'orderKey', 8)::bigint returning * into item;
    if not found then return jsonb_build_object('errorCode', 'not_found'); end if;
    return jsonb_build_object('removed', args->>'orderKey', 'storagePath', item.storage_path);
  end if;
  if command = 'decide' then
    if args->>'decision' is null then
      delete from melinda_private.pharmacy_order_decisions where order_key = args->>'orderKey';
      return jsonb_build_object('decision', null);
    end if;
    if (args->>'orderKey') like 'upload:%' and not exists (select 1 from melinda_private.pharmacy_orders where id = substr(args->>'orderKey', 8)::bigint) then
      return jsonb_build_object('errorCode', 'not_found');
    end if;
    if exists (select 1 from melinda_private.pharmacy_order_removed where order_key = args->>'orderKey') then
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
    select jsonb_agg(r.order_key order by r.removed_at) into removed from melinda_private.pharmacy_order_removed r;
    return jsonb_build_object('orders', coalesce(result, '[]'::jsonb), 'decisions', coalesce(decisions, '{}'::jsonb), 'removed', coalesce(removed, '[]'::jsonb));
  else
    return jsonb_build_object('errorCode', 'invalid_command');
  end if;
  return jsonb_build_object('order', jsonb_build_object('id', item.id, 'uploadedAt', item.uploaded_at, 'uploadedBy', item.uploaded_by,
    'fileName', item.file_name, 'contentType', item.content_type, 'byteSize', item.byte_size, 'sha256', item.sha256,
    'storagePath', item.storage_path, 'kind', item.kind, 'parsed', item.parsed, 'note', item.note), 'replayed', replayed);
end;
$$;

commit;
