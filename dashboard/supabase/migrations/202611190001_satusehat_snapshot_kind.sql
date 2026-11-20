-- Extend daily documents with aggregate SATUSEHAT snapshot records (`satusehat_snapshot`).
-- Apply once in the Supabase SQL Editor after 202611160001_referrals.sql.
begin;

select melinda_private.record_migration('202611190001', '202611190001_satusehat_snapshot_kind');

alter table melinda_private.daily_documents drop constraint if exists daily_documents_kind_check;

do $$
declare constraint_name text;
begin
  for constraint_name in
    select con.conname from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'melinda_private' and rel.relname = 'daily_documents'
      and con.contype = 'c' and pg_get_constraintdef(con.oid) ilike '%management_brief%'
  loop
    execute format('alter table melinda_private.daily_documents drop constraint %I', constraint_name);
  end loop;
end $$;

alter table melinda_private.daily_documents add constraint daily_documents_kind_check
  check (kind in ('management_brief', 'simrs_snapshot', 'puskesmas_brief', 'news_edition', 'medify_snapshot', 'medify_run_status', 'satusehat_snapshot'));

create or replace function public.melinda_daily_documents(command text, args jsonb)
returns jsonb language plpgsql security definer set search_path = ''
set lock_timeout = '1s' set statement_timeout = '5s'
as $$
declare
  document melinda_private.daily_documents%rowtype;
  kind_value text := args->>'kind'; selected_date date; lookback integer; replayed boolean := false;
begin
  if kind_value is null or kind_value not in ('management_brief', 'simrs_snapshot', 'puskesmas_brief', 'news_edition', 'medify_snapshot', 'medify_run_status', 'satusehat_snapshot') then return jsonb_build_object('errorCode', 'invalid_kind'); end if;
  if command = 'submit' then
    if octet_length((args->'payload')::text) > 256000 then return jsonb_build_object('errorCode', 'invalid_payload'); end if;
    begin selected_date := (args->>'date')::date; exception when others then return jsonb_build_object('errorCode', 'invalid_date'); end;
    perform pg_advisory_xact_lock(hashtextextended('daily:' || kind_value || ':' || (args->>'producerId') || ':' || (args->>'key'), 0));
    select * into document from melinda_private.daily_documents where kind = kind_value and producer = args->>'producerId' and request_key = args->>'key';
    if found then
      if document.payload_hash <> args->>'payloadHash' then return jsonb_build_object('errorCode', 'conflict'); end if;
      replayed := true;
    else
      insert into melinda_private.daily_documents(kind, report_date, producer, request_key, payload_hash, payload) values (kind_value, selected_date, args->>'producerId', args->>'key', args->>'payloadHash', args->'payload') returning * into document;
    end if;
    return jsonb_build_object('replayed', replayed, 'id', document.id, 'kind', document.kind, 'date', document.report_date, 'payloadHash', document.payload_hash, 'receivedAt', document.received_at);
  elsif command = 'read' then
    begin selected_date := (args->>'date')::date; exception when others then return jsonb_build_object('errorCode', 'invalid_date'); end;
    lookback := least(greatest(coalesce((args->>'lookbackDays')::integer, 0), 0), 6);
    select * into document from melinda_private.daily_documents where kind = kind_value and report_date = selected_date order by received_at desc, id desc limit 1;
    if not found and lookback > 0 then select * into document from melinda_private.daily_documents where kind = kind_value and report_date < selected_date and report_date >= selected_date - lookback order by report_date desc, received_at desc, id desc limit 1; end if;
    if not found then return jsonb_build_object('document', null); end if;
    return jsonb_build_object('document', jsonb_build_object('id', document.id, 'kind', document.kind, 'report_date', document.report_date, 'producer', document.producer, 'payload', document.payload, 'payload_hash', document.payload_hash, 'received_at', document.received_at));
  elsif command = 'latest' then
    select * into document from melinda_private.daily_documents where kind = kind_value order by report_date desc, received_at desc, id desc limit 1;
    if not found then return jsonb_build_object('document', null); end if;
    return jsonb_build_object('document', jsonb_build_object('id', document.id, 'kind', document.kind, 'report_date', document.report_date, 'producer', document.producer, 'payload_hash', document.payload_hash, 'received_at', document.received_at));
  end if;
  return jsonb_build_object('errorCode', 'invalid_command');
end;
$$;

comment on function public.melinda_daily_documents(text, jsonb) is 'Server-only store for daily publications, Medify status records, and aggregate SATUSEHAT snapshots.';
commit;
