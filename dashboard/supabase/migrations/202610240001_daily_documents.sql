-- Daily published documents: the Management Morning Brief and the SIMRS census snapshot.
-- Both used to live in the application bundle (a TypeScript constant and a JSON file on the
-- deployment filesystem). They are now published as data through the dashboard API so a new
-- day never needs a redeploy. Apply in the Supabase SQL Editor after 202610070002.
begin;

create table melinda_private.daily_documents (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('management_brief', 'simrs_snapshot')),
  report_date date not null,
  producer text not null,
  request_key text not null,
  payload_hash text not null check (length(payload_hash) = 64),
  payload jsonb not null,
  received_at timestamptz not null default clock_timestamp(),
  unique (kind, producer, request_key)
);
create index daily_documents_lookup on melinda_private.daily_documents (kind, report_date desc, received_at desc);

alter table melinda_private.daily_documents enable row level security;
revoke all on melinda_private.daily_documents from public, anon, authenticated, service_role;

create function public.melinda_daily_documents(command text, args jsonb)
returns jsonb language plpgsql security definer set search_path = ''
set lock_timeout = '1s' set statement_timeout = '5s'
as $$
declare
  document melinda_private.daily_documents%rowtype;
  kind_value text := args->>'kind';
  selected_date date;
  lookback integer;
  replayed boolean := false;
begin
  if kind_value is null or kind_value not in ('management_brief', 'simrs_snapshot') then
    return jsonb_build_object('errorCode', 'invalid_kind');
  end if;

  if command = 'submit' then
    if octet_length((args->'payload')::text) > 256000 then
      return jsonb_build_object('errorCode', 'invalid_payload');
    end if;
    begin
      selected_date := (args->>'date')::date;
    exception when others then
      return jsonb_build_object('errorCode', 'invalid_date');
    end;
    perform pg_advisory_xact_lock(hashtextextended('daily:' || kind_value || ':' || (args->>'producerId') || ':' || (args->>'key'), 0));
    select * into document from melinda_private.daily_documents
      where kind = kind_value and producer = args->>'producerId' and request_key = args->>'key';
    if found then
      if document.payload_hash <> args->>'payloadHash' then return jsonb_build_object('errorCode', 'conflict'); end if;
      replayed := true;
    else
      insert into melinda_private.daily_documents(kind, report_date, producer, request_key, payload_hash, payload)
        values (kind_value, selected_date, args->>'producerId', args->>'key', args->>'payloadHash', args->'payload')
        returning * into document;
    end if;
    return jsonb_build_object('replayed', replayed, 'id', document.id, 'kind', document.kind, 'date', document.report_date,
      'payloadHash', document.payload_hash, 'receivedAt', document.received_at);

  elsif command = 'read' then
    begin
      selected_date := (args->>'date')::date;
    exception when others then
      return jsonb_build_object('errorCode', 'invalid_date');
    end;
    lookback := least(greatest(coalesce((args->>'lookbackDays')::integer, 0), 0), 6);
    select * into document from melinda_private.daily_documents
      where kind = kind_value and report_date = selected_date
      order by received_at desc, id desc limit 1;
    if not found and lookback > 0 then
      select * into document from melinda_private.daily_documents
        where kind = kind_value and report_date < selected_date and report_date >= selected_date - lookback
        order by report_date desc, received_at desc, id desc limit 1;
    end if;
    if not found then return jsonb_build_object('document', null); end if;
    return jsonb_build_object('document', jsonb_build_object('id', document.id, 'kind', document.kind, 'report_date', document.report_date,
      'producer', document.producer, 'payload', document.payload, 'payload_hash', document.payload_hash, 'received_at', document.received_at));

  elsif command = 'latest' then
    select * into document from melinda_private.daily_documents where kind = kind_value
      order by report_date desc, received_at desc, id desc limit 1;
    if not found then return jsonb_build_object('document', null); end if;
    return jsonb_build_object('document', jsonb_build_object('id', document.id, 'kind', document.kind, 'report_date', document.report_date,
      'producer', document.producer, 'payload_hash', document.payload_hash, 'received_at', document.received_at));
  end if;

  return jsonb_build_object('errorCode', 'invalid_command');
end;
$$;

revoke all on function public.melinda_daily_documents(text, jsonb) from public, anon, authenticated;
grant execute on function public.melinda_daily_documents(text, jsonb) to service_role;
comment on function public.melinda_daily_documents(text, jsonb) is 'Server-only store for the Management Morning Brief and SIMRS census snapshots published per day.';
commit;
