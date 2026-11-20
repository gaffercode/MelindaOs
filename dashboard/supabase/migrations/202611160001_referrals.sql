-- Referral intake: one row per public referral sheet submitted from `/rujukan`.
-- The public API validates the draft in TypeScript; this function enforces the storage
-- boundary (shape, size, status vocabulary) and is executable by service_role only.
-- `submit` is idempotent on the client's Idempotency-Key, `list` is newest first, and
-- `update` is the dashboard's status change with an optional follow-up note.
-- Apply in the Supabase SQL Editor; the agent has no database access.
begin;

select melinda_private.record_migration('202611160001', '202611160001_referrals');

create table melinda_private.referrals (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique check (reference ~ '^RJ-[0-9]{8}-[A-F0-9]{8}$'),
  idempotency_key text not null unique check (idempotency_key ~ '^[A-Za-z0-9_-]{8,128}$'),
  received_at timestamptz not null default clock_timestamp(),
  status text not null default 'baru' check (status in ('baru', 'dihubungi', 'diterima', 'ditolak', 'selesai')),
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 32768),
  note text check (note is null or length(note) <= 1000),
  handled_by text check (handled_by is null or length(handled_by) between 1 and 80),
  handled_at timestamptz
);
create index referrals_received_at_idx on melinda_private.referrals (received_at desc, id);
create index referrals_status_idx on melinda_private.referrals (status, received_at desc);
alter table melinda_private.referrals enable row level security;
revoke all on melinda_private.referrals from public, anon, authenticated, service_role;

create function public.melinda_referrals(command text, args jsonb)
returns jsonb language plpgsql security definer set search_path = ''
set lock_timeout = '1s' set statement_timeout = '5s'
as $$
declare
  invalid constant jsonb := jsonb_build_object('errorCode', 'invalid_command');
  v_key text;
  v_payload jsonb;
  v_status text;
  v_note text;
  v_actor text;
  v_id uuid;
  v_reference text;
  v_received timestamptz;
  v_row melinda_private.referrals%rowtype;
  result jsonb;
begin
  if command is null or jsonb_typeof(args) is distinct from 'object' then
    return invalid;
  end if;

  if command = 'submit' then
    if jsonb_typeof(args->'key') is distinct from 'string'
      or jsonb_typeof(args->'payload') is distinct from 'object' then
      return invalid;
    end if;
    v_key := args->>'key';
    v_payload := args->'payload';
    if v_key !~ '^[A-Za-z0-9_-]{8,128}$'
      or octet_length(v_payload::text) > 32768
      or (v_payload->>'consent') is distinct from 'true'
      or jsonb_typeof(v_payload->'patient') is distinct from 'object'
      or jsonb_typeof(v_payload->'referrer') is distinct from 'object'
      or jsonb_typeof(v_payload->'clinical') is distinct from 'object'
      or coalesce(length(v_payload->'patient'->>'name') not between 1 and 120, true)
      or coalesce(length(v_payload->'referrer'->>'facility') not between 1 and 160, true)
      or coalesce(length(v_payload->'clinical'->>'diagnosis') > 200, false) then
      return invalid;
    end if;
    select * into v_row from melinda_private.referrals where idempotency_key = v_key;
    if found then
      return jsonb_build_object('reference', v_row.reference, 'receivedAt', v_row.received_at, 'replayed', true);
    end if;
    v_id := gen_random_uuid();
    v_reference := 'RJ-' || to_char(clock_timestamp() at time zone 'Asia/Jakarta', 'YYYYMMDD') || '-' || upper(substr(replace(v_id::text, '-', ''), 1, 8));
    insert into melinda_private.referrals (id, reference, idempotency_key, payload)
    values (v_id, v_reference, v_key, v_payload)
    returning received_at into v_received;
    return jsonb_build_object('reference', v_reference, 'receivedAt', v_received, 'replayed', false);
  end if;

  if command = 'list' then
    if args ? 'status' then
      if jsonb_typeof(args->'status') is distinct from 'string'
        or (args->>'status') not in ('baru', 'dihubungi', 'diterima', 'ditolak', 'selesai') then
        return invalid;
      end if;
      v_status := args->>'status';
    end if;
    if args ? 'limit' then
      if jsonb_typeof(args->'limit') is distinct from 'number' then
        return invalid;
      end if;
      if (args->>'limit')::numeric not between 1 and 100
        or (args->>'limit')::numeric <> trunc((args->>'limit')::numeric) then
        return invalid;
      end if;
    end if;
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', t.id, 'reference', t.reference, 'receivedAt', t.received_at, 'status', t.status,
             'payload', t.payload, 'note', t.note, 'handledBy', t.handled_by, 'handledAt', t.handled_at)
           order by t.received_at desc, t.id), '[]'::jsonb)
      into result
      from (
        select * from melinda_private.referrals
         where v_status is null or status = v_status
         order by received_at desc, id
         limit coalesce((args->>'limit')::integer, 50)
      ) t;
    return jsonb_build_object('referrals', result);
  end if;

  if command = 'update' then
    if jsonb_typeof(args->'id') is distinct from 'string'
      or jsonb_typeof(args->'status') is distinct from 'string'
      or jsonb_typeof(args->'actor') is distinct from 'string'
      or (args ? 'note' and jsonb_typeof(args->'note') is distinct from 'string') then
      return invalid;
    end if;
    begin
      v_id := (args->>'id')::uuid;
    exception when others then
      return invalid;
    end;
    v_status := args->>'status';
    v_actor := btrim(args->>'actor');
    v_note := nullif(btrim(coalesce(args->>'note', '')), '');
    if v_status not in ('baru', 'dihubungi', 'diterima', 'ditolak', 'selesai')
      or length(v_actor) not between 1 and 80
      or coalesce(length(v_note) > 1000, false) then
      return invalid;
    end if;
    update melinda_private.referrals
       set status = v_status, note = v_note, handled_by = v_actor, handled_at = clock_timestamp()
     where id = v_id
    returning * into v_row;
    if not found then
      return jsonb_build_object('errorCode', 'not_found');
    end if;
    return jsonb_build_object('referral', jsonb_build_object(
      'id', v_row.id, 'reference', v_row.reference, 'receivedAt', v_row.received_at, 'status', v_row.status,
      'payload', v_row.payload, 'note', v_row.note, 'handledBy', v_row.handled_by, 'handledAt', v_row.handled_at));
  end if;

  return invalid;
end;
$$;

revoke all on function public.melinda_referrals(text, jsonb) from public, anon, authenticated;
grant execute on function public.melinda_referrals(text, jsonb) to service_role;

commit;
