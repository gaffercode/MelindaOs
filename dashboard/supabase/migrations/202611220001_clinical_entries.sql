-- Clinical entries: handover, duty roster and incident reports typed in by the Director or a doctor on `/klinis`.
-- One row per entry, `kind` picks the payload shape. The dashboard API validates the payload deeply in
-- TypeScript; this function enforces the storage boundary (kind, shift, size, status vocabulary) and is
-- executable by service_role only. Commands: create (idempotent on `key`), list, update (edit or cancel),
-- audit_read (one row per MCP read with the range, limit and ids returned, because every MCP caller shares one identity).
-- Also lets the account role `DOCTOR` exist in access_users; the Director is still never an account.
-- Apply in the Supabase SQL Editor; the agent has no database access.
begin;

select melinda_private.record_migration('202611220001', '202611220001_clinical_entries');

alter table melinda_private.access_users drop constraint access_users_role_check;
alter table melinda_private.access_users add constraint access_users_role_check
  check (role in ('VICE_DIRECTOR', 'DOCTOR', 'STAFF_FINANCE', 'STAFF_HR', 'STAFF_OPS', 'STAFF_SUPPORT'));

create table melinda_private.clinical_entries (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique check (idempotency_key ~ '^[A-Za-z0-9_-]{8,128}$'),
  kind text not null check (kind in ('handover', 'roster', 'insiden')),
  entry_date date not null check (entry_date between date '2020-01-01' and date '2100-12-31'),
  shift text check (shift is null or shift in ('pagi', 'siang', 'malam')),
  unit text not null check (length(unit) between 1 and 60),
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 16384),
  status text not null default 'aktif' check (status in ('aktif', 'dibatalkan')),
  revision integer not null default 1 check (revision >= 1),
  created_by text not null check (length(created_by) between 1 and 80),
  created_at timestamptz not null default clock_timestamp(),
  updated_by text check (updated_by is null or length(updated_by) between 1 and 80),
  updated_at timestamptz,
  -- a handover or roster always belongs to a shift; only an incident may go without
  check (kind = 'insiden' or shift is not null)
);
create index clinical_entries_kind_date_idx on melinda_private.clinical_entries (kind, entry_date desc, created_at desc);
alter table melinda_private.clinical_entries enable row level security;
revoke all on melinda_private.clinical_entries from public, anon, authenticated, service_role;

create table melinda_private.clinical_reads (
  id bigint generated always as identity primary key,
  read_at timestamptz not null default clock_timestamp(),
  kind text not null check (kind in ('handover', 'roster', 'insiden')),
  reader text not null check (length(reader) between 1 and 80),
  row_count integer not null check (row_count >= 0),
  detail jsonb check (detail is null or (jsonb_typeof(detail) = 'object' and octet_length(detail::text) <= 8192))
);
alter table melinda_private.clinical_reads enable row level security;
revoke all on melinda_private.clinical_reads from public, anon, authenticated, service_role;
revoke all on sequence melinda_private.clinical_reads_id_seq from public, anon, authenticated, service_role;

create function public.melinda_clinical(command text, args jsonb)
returns jsonb language plpgsql security definer set search_path = ''
set lock_timeout = '1s' set statement_timeout = '5s'
as $$
declare
  invalid constant jsonb := jsonb_build_object('errorCode', 'invalid_command');
  v_key text;
  v_kind text;
  v_date date;
  v_from date;
  v_to date;
  v_shift text;
  v_unit text;
  v_payload jsonb;
  v_status text;
  v_actor text;
  v_id uuid;
  v_limit integer;
  v_count integer;
  v_row melinda_private.clinical_entries%rowtype;
  result jsonb;
begin
  if command is null or jsonb_typeof(args) is distinct from 'object' then
    return invalid;
  end if;

  if command = 'create' then
    if jsonb_typeof(args->'key') is distinct from 'string'
      or jsonb_typeof(args->'kind') is distinct from 'string'
      or jsonb_typeof(args->'date') is distinct from 'string'
      or jsonb_typeof(args->'unit') is distinct from 'string'
      or jsonb_typeof(args->'payload') is distinct from 'object'
      or jsonb_typeof(args->'actor') is distinct from 'string'
      or coalesce(jsonb_typeof(args->'shift'), 'null') not in ('string', 'null') then
      return invalid;
    end if;
    v_key := args->>'key';
    v_kind := args->>'kind';
    v_unit := btrim(args->>'unit');
    v_shift := nullif(args->>'shift', '');
    v_payload := args->'payload';
    v_actor := btrim(args->>'actor');
    begin
      v_date := (args->>'date')::date;
    exception when others then
      return invalid;
    end;
    if v_key !~ '^[A-Za-z0-9_-]{8,128}$'
      or v_kind not in ('handover', 'roster', 'insiden')
      or length(v_unit) not between 1 and 60
      or (v_shift is not null and v_shift not in ('pagi', 'siang', 'malam'))
      or (v_kind <> 'insiden' and v_shift is null)
      or v_date not between date '2020-01-01' and date '2100-12-31'
      or octet_length(v_payload::text) > 16384
      or length(v_actor) not between 1 and 80 then
      return invalid;
    end if;
    -- a concurrent request with the same key loses the race here and replays the stored row
    insert into melinda_private.clinical_entries (idempotency_key, kind, entry_date, shift, unit, payload, created_by)
    values (v_key, v_kind, v_date, v_shift, v_unit, v_payload, v_actor)
    on conflict (idempotency_key) do nothing
    returning * into v_row;
    if found then
      return jsonb_build_object('id', v_row.id, 'createdAt', v_row.created_at, 'replayed', false);
    end if;
    select * into v_row from melinda_private.clinical_entries where idempotency_key = v_key;
    return jsonb_build_object('id', v_row.id, 'createdAt', v_row.created_at, 'replayed', true);
  end if;

  if command = 'list' then
    if args ? 'kind' then
      if jsonb_typeof(args->'kind') is distinct from 'string' or (args->>'kind') not in ('handover', 'roster', 'insiden') then
        return invalid;
      end if;
      v_kind := args->>'kind';
    end if;
    begin
      if args ? 'from' then v_from := (args->>'from')::date; end if;
      if args ? 'to' then v_to := (args->>'to')::date; end if;
    exception when others then
      return invalid;
    end;
    if args ? 'status' then
      if jsonb_typeof(args->'status') is distinct from 'string' or (args->>'status') not in ('aktif', 'dibatalkan') then
        return invalid;
      end if;
      v_status := args->>'status';
    end if;
    v_limit := 100;
    if args ? 'limit' then
      if jsonb_typeof(args->'limit') is distinct from 'number'
        or (args->>'limit')::numeric not between 1 and 200
        or (args->>'limit')::numeric <> trunc((args->>'limit')::numeric) then
        return invalid;
      end if;
      v_limit := (args->>'limit')::integer;
    end if;
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', t.id, 'kind', t.kind, 'date', t.entry_date, 'shift', t.shift, 'unit', t.unit,
             'payload', t.payload, 'status', t.status, 'revision', t.revision,
             'createdBy', t.created_by, 'createdAt', t.created_at, 'updatedBy', t.updated_by, 'updatedAt', t.updated_at)
           order by t.entry_date desc, t.created_at desc, t.id), '[]'::jsonb)
      into result
      from (
        select * from melinda_private.clinical_entries
         where (v_kind is null or kind = v_kind)
           and (v_from is null or entry_date >= v_from)
           and (v_to is null or entry_date <= v_to)
           and (v_status is null or status = v_status)
         order by entry_date desc, created_at desc, id
         limit v_limit
      ) t;
    return jsonb_build_object('entries', result);
  end if;

  if command = 'update' then
    if jsonb_typeof(args->'id') is distinct from 'string'
      or jsonb_typeof(args->'actor') is distinct from 'string'
      or jsonb_typeof(args->'revision') is distinct from 'number' then
      return invalid;
    end if;
    begin
      v_id := (args->>'id')::uuid;
    exception when others then
      return invalid;
    end;
    v_actor := btrim(args->>'actor');
    if length(v_actor) not between 1 and 80
      or (args->>'revision')::numeric not between 1 and 2147483646
      or (args->>'revision')::numeric <> trunc((args->>'revision')::numeric) then
      return invalid;
    end if;
    select * into v_row from melinda_private.clinical_entries where id = v_id for update;
    if not found then
      return jsonb_build_object('errorCode', 'not_found');
    end if;
    if v_row.revision <> (args->>'revision')::integer then
      return jsonb_build_object('errorCode', 'conflict');
    end if;
    v_status := v_row.status;
    if args ? 'status' then
      if jsonb_typeof(args->'status') is distinct from 'string' or (args->>'status') not in ('aktif', 'dibatalkan') then
        return invalid;
      end if;
      v_status := args->>'status';
    end if;
    v_payload := v_row.payload;
    if args ? 'payload' then
      -- the API validated the payload against this kind; refuse a payload checked for another kind
      if jsonb_typeof(args->'payload') is distinct from 'object' or octet_length((args->'payload')::text) > 16384
        or (args->>'kind') is distinct from v_row.kind then
        return invalid;
      end if;
      v_payload := args->'payload';
    end if;
    v_unit := v_row.unit;
    if args ? 'unit' then
      if jsonb_typeof(args->'unit') is distinct from 'string' or length(btrim(args->>'unit')) not between 1 and 60 then
        return invalid;
      end if;
      v_unit := btrim(args->>'unit');
    end if;
    v_shift := v_row.shift;
    if args ? 'shift' then
      if coalesce(jsonb_typeof(args->'shift'), 'null') not in ('string', 'null')
        or (nullif(args->>'shift', '') is not null and (args->>'shift') not in ('pagi', 'siang', 'malam')) then
        return invalid;
      end if;
      v_shift := nullif(args->>'shift', '');
    end if;
    if v_row.kind <> 'insiden' and v_shift is null then
      return invalid;
    end if;
    update melinda_private.clinical_entries
       set status = v_status, payload = v_payload, unit = v_unit, shift = v_shift,
           revision = revision + 1, updated_by = v_actor, updated_at = clock_timestamp()
     where id = v_id
    returning * into v_row;
    return jsonb_build_object('entry', jsonb_build_object(
      'id', v_row.id, 'kind', v_row.kind, 'date', v_row.entry_date, 'shift', v_row.shift, 'unit', v_row.unit,
      'payload', v_row.payload, 'status', v_row.status, 'revision', v_row.revision,
      'createdBy', v_row.created_by, 'createdAt', v_row.created_at, 'updatedBy', v_row.updated_by, 'updatedAt', v_row.updated_at));
  end if;

  if command = 'audit_read' then
    if jsonb_typeof(args->'kind') is distinct from 'string'
      or jsonb_typeof(args->'reader') is distinct from 'string'
      or jsonb_typeof(args->'count') is distinct from 'number' then
      return invalid;
    end if;
    v_kind := args->>'kind';
    v_actor := btrim(args->>'reader');
    if v_kind not in ('handover', 'roster', 'insiden')
      or length(v_actor) not between 1 and 80
      or (args->>'count')::numeric not between 0 and 100000
      or (args->>'count')::numeric <> trunc((args->>'count')::numeric) then
      return invalid;
    end if;
    if args ? 'detail' and (jsonb_typeof(args->'detail') is distinct from 'object' or octet_length((args->'detail')::text) > 8192) then
      return invalid;
    end if;
    v_count := (args->>'count')::integer;
    insert into melinda_private.clinical_reads (kind, reader, row_count, detail) values (v_kind, v_actor, v_count, args->'detail');
    return jsonb_build_object('ok', true);
  end if;

  return invalid;
end;
$$;

revoke all on function public.melinda_clinical(text, jsonb) from public, anon, authenticated;
grant execute on function public.melinda_clinical(text, jsonb) to service_role;

commit;
