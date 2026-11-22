-- Schedule overrides: a meeting added, moved or cancelled on one day of one structural role's schedule. The baseline
-- schedule stays a template in the content file; the dashboard applies these rows on every read and every sync, so the
-- Sync button no longer drops a change. Commands: add (idempotent on `key`), list (one date, optional role).
-- Executable by service_role only. Apply in the Supabase SQL Editor; the agent has no database access.
begin;

select melinda_private.record_migration('202611220003', '202611220003_schedule_overrides');

create table melinda_private.schedule_overrides (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (char_length(key) between 1 and 120),
  schedule_date date not null,
  role_id text not null check (role_id in ('direktur','wadir_ops','wadir_keu_sdm','kabag_pelayanan','kabag_umum','kabag_penunjang','kepala_sdm','kepala_keuangan')),
  kind text not null check (kind in ('add','move','cancel')),
  slot_id text check (slot_id is null or char_length(slot_id) between 1 and 80),
  start_time text check (start_time is null or start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  end_time text check (end_time is null or end_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  title text check (title is null or char_length(title) between 1 and 200),
  place text check (place is null or char_length(place) <= 120),
  note text not null default '' check (char_length(note) <= 200),
  producer text not null check (char_length(producer) between 1 and 60),
  created_at timestamptz not null default clock_timestamp(),
  check ((kind = 'add' and slot_id is null and start_time is not null and title is not null)
    or (kind = 'move' and slot_id is not null and start_time is not null)
    or (kind = 'cancel' and slot_id is not null)),
  check (end_time is null or start_time is null or end_time > start_time)
);
create index schedule_overrides_day on melinda_private.schedule_overrides (schedule_date, role_id, created_at);

alter table melinda_private.schedule_overrides enable row level security;
revoke all on melinda_private.schedule_overrides from public, anon, authenticated, service_role;

create function public.melinda_schedule_overrides(command text, args jsonb)
returns jsonb language plpgsql security definer set search_path = ''
set lock_timeout = '1s' set statement_timeout = '5s'
as $$
declare
  row_data melinda_private.schedule_overrides%rowtype;
  day date;
  result jsonb;
begin
  begin
    day := (args->>'date')::date;
  exception when others then
    return jsonb_build_object('errorCode', 'invalid_input');
  end;
  if day is null then return jsonb_build_object('errorCode', 'invalid_input'); end if;

  if command = 'list' then
    select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'date', o.schedule_date, 'role', o.role_id, 'kind', o.kind,
      'slotId', o.slot_id, 'start', o.start_time, 'end', o.end_time, 'title', o.title, 'place', o.place, 'note', o.note,
      'createdAt', o.created_at) order by o.created_at), '[]') into result
    from melinda_private.schedule_overrides o
    where o.schedule_date = day and (args->>'role' is null or o.role_id = args->>'role');
    return jsonb_build_object('overrides', result);
  elsif command <> 'add' then
    return jsonb_build_object('errorCode', 'invalid_command');
  end if;

  select * into row_data from melinda_private.schedule_overrides o where o.key = args->>'key';
  if not found then
    begin
      insert into melinda_private.schedule_overrides (key, schedule_date, role_id, kind, slot_id, start_time, end_time, title, place, note, producer)
      values (args->>'key', day, args->>'role', args->>'kind', args->>'slotId', args->>'start', args->>'end',
        nullif(btrim(args->>'title'), ''), nullif(btrim(args->>'place'), ''), coalesce(btrim(args->>'note'), ''), args->>'producer')
      returning * into row_data;
    exception when check_violation or not_null_violation then
      return jsonb_build_object('errorCode', 'invalid_input');
    end;
  end if;
  return jsonb_build_object('override', jsonb_build_object('id', row_data.id, 'date', row_data.schedule_date, 'role', row_data.role_id,
    'kind', row_data.kind, 'slotId', row_data.slot_id, 'start', row_data.start_time, 'end', row_data.end_time, 'title', row_data.title,
    'place', row_data.place, 'note', row_data.note, 'createdAt', row_data.created_at));
end;
$$;

revoke all on function public.melinda_schedule_overrides(text, jsonb) from public, anon, authenticated;
grant execute on function public.melinda_schedule_overrides(text, jsonb) to service_role;
comment on function public.melinda_schedule_overrides(text, jsonb) is 'Server-only schedule overrides for the structural roles. Never expose the Supabase secret key to a browser or Bot.';

commit;
