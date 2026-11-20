-- Director tasks (Katt orchestrates, Dash runs the dashboard): the Director's schedule posted by Dash, an append-only
-- log of staff replies, Director-final statuses (ditunda, dibatalkan), reminder bookkeeping, Dash heartbeats, and the
-- board/archive queries. New RPC public.melinda_director_tasks; public.melinda_director_instructions is re-created
-- from 202610300001 with these changes only: `create` stores linkedId and scheduleItemId, every instruction object
-- carries linkedId, scheduleItemId, remindersSent and lastReminderAt, `open` leaves out ditunda/dibatalkan, and
-- `advance` refuses every transition out of ditunda/dibatalkan. Instructions and staff replies are never deleted (no
-- delete command exists); `schedule_replace` replaces a day's unlinked schedule rows and never touches a linked one.
-- Apply in the Supabase SQL Editor after every prior migration, before deploying the dashboard build that uses it.
begin;

create table melinda_private.schedule_items (
  id uuid primary key default gen_random_uuid(),
  schedule_date date not null,
  position int not null,
  start_time text not null check (start_time ~ '^\d{2}:\d{2}$'),
  end_time text check (end_time is null or end_time ~ '^\d{2}:\d{2}$'),
  title text not null check (length(title) between 1 and 200),
  place text check (length(place) <= 120),
  pic jsonb not null default '[]',
  producer text not null,
  created_at timestamptz default clock_timestamp(),
  unique (schedule_date, position)
);
alter table melinda_private.schedule_items enable row level security;
revoke all on melinda_private.schedule_items from public, anon, authenticated, service_role;

alter table melinda_private.instructions
  add column schedule_item_id uuid null references melinda_private.schedule_items(id),
  add column reminders_sent int not null default 0,
  add column last_reminder_at timestamptz null,
  add column linked_id text null;
create index instructions_schedule_item on melinda_private.instructions (schedule_item_id) where schedule_item_id is not null;
alter table melinda_private.instructions drop constraint instructions_status_check;
alter table melinda_private.instructions add constraint instructions_status_check
  check (status in ('dibuat','terkirim_ke_grokbot','gagal','diteruskan','diterima_pic','dikerjakan','terkendala','selesai','ditunda','dibatalkan'));

create table melinda_private.staff_replies (
  id uuid primary key default gen_random_uuid(),
  instruction_id text not null references melinda_private.instructions(id),
  request_key text not null unique,
  received_at timestamptz not null,
  from_name text not null check (length(from_name) <= 120),
  original_text text not null check (length(original_text) between 1 and 4000),
  attachments jsonb not null default '[]',
  summary text check (length(summary) <= 400),
  needs text check (length(needs) <= 280),
  classified_status text not null check (classified_status in ('diterima_pic','dikerjakan','selesai','terkendala','perlu_dibaca')),
  confidence numeric check (confidence between 0 and 1),
  producer text not null,
  created_at timestamptz default clock_timestamp()
);
create index staff_replies_instruction on melinda_private.staff_replies (instruction_id, received_at desc, created_at desc);
alter table melinda_private.staff_replies enable row level security;
revoke all on melinda_private.staff_replies from public, anon, authenticated, service_role;

create table melinda_private.agent_heartbeats (
  producer text primary key,
  seen_at timestamptz not null
);
alter table melinda_private.agent_heartbeats enable row level security;
revoke all on melinda_private.agent_heartbeats from public, anon, authenticated, service_role;

-- One JSON shape for an instruction, shared by both RPCs.
create function melinda_private.instruction_json(i melinda_private.instructions)
returns jsonb language sql stable set search_path = ''
as $$
  select jsonb_build_object('id', i.id, 'reportDate', i.report_date, 'section', i.section, 'itemId', i.item_id,
    'itemTitle', i.item_title, 'urgent', i.urgent, 'action', i.action, 'deadline', i.deadline, 'pic', i.pic, 'note', i.note,
    'decisionOptionId', i.decision_option_id, 'decisionLabel', i.decision_label, 'status', i.status, 'history', i.history,
    'createdAt', i.created_at, 'linkedId', i.linked_id, 'scheduleItemId', i.schedule_item_id,
    'remindersSent', i.reminders_sent, 'lastReminderAt', i.last_reminder_at)
$$;

create function melinda_private.staff_reply_json(r melinda_private.staff_replies)
returns jsonb language sql stable set search_path = ''
as $$
  select jsonb_build_object('id', r.id, 'instructionId', r.instruction_id, 'key', r.request_key, 'receivedAt', r.received_at,
    'fromName', r.from_name, 'originalText', r.original_text, 'attachments', r.attachments, 'summary', r.summary,
    'needs', r.needs, 'classifiedStatus', r.classified_status, 'confidence', r.confidence, 'producer', r.producer,
    'createdAt', r.created_at)
$$;

-- Archive rule: a "Tandai selesai" record (action done) always; otherwise Director-final or finished, and the last
-- history entry more than 7 days before `reference`.
create function melinda_private.instruction_archived(i melinda_private.instructions, reference timestamptz)
returns boolean language sql stable set search_path = ''
as $$
  select i.action = 'done' or i.status in ('selesai','ditunda','dibatalkan')
    and coalesce((i.history -> -1 ->> 'at')::timestamptz, i.created_at) < reference - interval '7 days'
$$;

revoke all on function melinda_private.instruction_json(melinda_private.instructions) from public, anon, authenticated, service_role;
revoke all on function melinda_private.staff_reply_json(melinda_private.staff_replies) from public, anon, authenticated, service_role;
revoke all on function melinda_private.instruction_archived(melinda_private.instructions, timestamptz) from public, anon, authenticated, service_role;

create or replace function public.melinda_director_instructions(command text, args jsonb)
returns jsonb language plpgsql security definer set search_path = ''
set lock_timeout = '1s' set statement_timeout = '5s'
as $$
declare
  item melinda_private.instructions%rowtype;
  result jsonb;
  progress text[] := array['terkirim_ke_grokbot','diteruskan','diterima_pic','dikerjakan','selesai'];
  forward text[] := array['diteruskan','diterima_pic','dikerjakan','selesai'];
  replayed boolean := false;
  history_note text;
  from_status text;
  to_status text;
  allowed boolean;
begin
  if command = 'create' then
    if args->>'scheduleItemId' is not null then
      if args->>'scheduleItemId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        return jsonb_build_object('errorCode', 'invalid_input');
      end if;
      if not exists (select 1 from melinda_private.schedule_items where id = (args->>'scheduleItemId')::uuid) then
        return jsonb_build_object('errorCode', 'not_found');
      end if;
    end if;
    if args->>'linkedId' is not null and args->>'linkedId' !~ '^IOC-[0-9]{4,9}$' then
      return jsonb_build_object('errorCode', 'invalid_input');
    end if;
    perform pg_advisory_xact_lock(hashtextextended('instruction:' || (args->>'reviewerId') || ':' || (args->>'key'), 0));
    select * into item from melinda_private.instructions where reviewer = args->>'reviewerId' and request_key = args->>'key';
    if found then
      if item.request_hash <> args->>'requestHash' then return jsonb_build_object('errorCode', 'conflict'); end if;
      replayed := true;
    else
      insert into melinda_private.instructions(reviewer, request_key, request_hash, report_date, section, item_id, item_title, urgent,
        action, deadline, pic, note, decision_option_id, decision_label, history, linked_id, schedule_item_id)
      values(args->>'reviewerId', args->>'key', args->>'requestHash', (args->>'reportDate')::date, args->>'section', args->>'itemId',
        args->>'itemTitle', (args->>'urgent')::boolean, args->>'action', args->>'deadline', coalesce(args->'pic', '[]'), coalesce(args->>'note', ''),
        args->>'decisionOptionId', args->>'decisionLabel',
        jsonb_build_array(jsonb_build_object('status', 'dibuat', 'at', clock_timestamp(), 'actor', args->>'reviewerId')),
        args->>'linkedId', (args->>'scheduleItemId')::uuid)
      returning * into item;
    end if;
  elsif command = 'mark' then
    if args->>'status' not in ('terkirim_ke_grokbot','gagal') then return jsonb_build_object('errorCode', 'invalid_status'); end if;
    select * into item from melinda_private.instructions where id = args->>'id' for update;
    if not found then return jsonb_build_object('errorCode', 'not_found'); end if;
    if item.status not in ('dibuat','gagal') then return jsonb_build_object('errorCode', 'conflict'); end if;
    update melinda_private.instructions set status = args->>'status',
      history = history || jsonb_build_object('status', args->>'status', 'at', clock_timestamp(), 'actor', args->>'actor')
      where id = item.id returning * into item;
  elsif command = 'advance' then
    select * into item from melinda_private.instructions where id = args->>'id' for update;
    if not found then return jsonb_build_object('errorCode', 'not_found'); end if;
    -- Director-final statuses are terminal: a staff report can never revive a postponed or cancelled task.
    if item.status in ('ditunda','dibatalkan') then return jsonb_build_object('errorCode', 'conflict'); end if;
    history_note := nullif(btrim(coalesce(args->>'note', '')), '');
    if history_note is not null and (length(history_note) > 280 or history_note ~ '[[:cntrl:]]') then
      return jsonb_build_object('errorCode', 'invalid_status');
    end if;
    from_status := item.status;
    to_status := args->>'status';
    allowed := false;
    if from_status in ('dibuat','gagal') and to_status = any (forward) then
      allowed := true;
    elsif from_status in ('diteruskan','diterima_pic','dikerjakan') and to_status = 'terkendala' then
      allowed := true;
    elsif from_status in ('dibuat','gagal') and to_status = 'terkendala' and history_note is not null then
      allowed := true;
    elsif from_status = 'terkendala' and to_status in ('dikerjakan','selesai') then
      allowed := true;
    elsif from_status = 'terkendala' and to_status in ('diteruskan','diterima_pic')
      and not exists (select 1 from jsonb_array_elements(item.history) h where h->>'status' = any (forward)) then
      allowed := true;
    elsif from_status = 'terkendala' and to_status = 'terkendala' and history_note is not null
      and history_note is distinct from (item.history -> -1 ->> 'note') then
      allowed := true;
    elsif from_status = any (progress) and to_status = any (progress)
      and coalesce(array_position(progress, to_status), 0) > coalesce(array_position(progress, from_status), 0) then
      allowed := true;
    end if;
    if not allowed then return jsonb_build_object('errorCode', 'conflict'); end if;
    update melinda_private.instructions set status = to_status,
      history = history || case when history_note is null
        then jsonb_build_object('status', to_status, 'at', clock_timestamp(), 'actor', args->>'actor')
        else jsonb_build_object('status', to_status, 'at', clock_timestamp(), 'actor', args->>'actor', 'note', history_note)
      end
      where id = item.id returning * into item;
  elsif command = 'read' then
    select * into item from melinda_private.instructions where id = args->>'id';
    if not found then return jsonb_build_object('errorCode', 'not_found'); end if;
  elsif command = 'list' then
    select jsonb_agg(melinda_private.instruction_json(i.t) order by i.created_at)
      into result from (select t, t.created_at from melinda_private.instructions t
        where t.report_date = (args->>'date')::date order by t.created_at limit 200) i;
    return jsonb_build_object('instructions', coalesce(result, '[]'::jsonb));
  elsif command = 'open' then
    select jsonb_agg(melinda_private.instruction_json(i.t) order by i.report_date, i.created_at)
      into result from (select t, t.report_date, t.created_at from melinda_private.instructions t
        where t.report_date between (args->>'from')::date and (args->>'to')::date
          and t.status not in ('selesai','ditunda','dibatalkan') and t.action <> 'done'
        order by t.report_date, t.created_at limit 500) i;
    return jsonb_build_object('instructions', coalesce(result, '[]'::jsonb));
  else
    return jsonb_build_object('errorCode', 'invalid_command');
  end if;
  return jsonb_build_object('instruction', melinda_private.instruction_json(item), 'replayed', replayed);
end;
$$;

create function public.melinda_director_tasks(command text, args jsonb)
returns jsonb language plpgsql security definer set search_path = ''
set lock_timeout = '1s' set statement_timeout = '5s'
as $$
declare
  item melinda_private.instructions%rowtype;
  reply melinda_private.staff_replies%rowtype;
  entry jsonb;
  result jsonb;
  advanced jsonb;
  day date;
  reference timestamptz;
  received timestamptz;
  at_time timestamptz;
  page_offset int;
  position_index int;
  status_applied boolean;
  history_note text;
  pattern text;
  pic_pattern text;
  hhmm text := '^([01][0-9]|2[0-3]):[0-5][0-9]$';
begin
  if command = 'schedule_replace' then
    begin
      day := (args->>'date')::date;
    exception when others then
      return jsonb_build_object('errorCode', 'invalid_input');
    end;
    if day is null or jsonb_typeof(args->'items') is distinct from 'array' or jsonb_array_length(args->'items') > 40
      or coalesce(btrim(args->>'producer'), '') = '' or length(args->>'producer') > 60 then
      return jsonb_build_object('errorCode', 'invalid_input');
    end if;
    for entry in select value from jsonb_array_elements(args->'items') loop
      if jsonb_typeof(entry) is distinct from 'object'
        or coalesce(entry->>'start', '') !~ hhmm
        or (entry->>'end' is not null and entry->>'end' !~ hhmm)
        or coalesce(btrim(entry->>'title'), '') = '' or length(entry->>'title') > 200
        or length(entry->>'place') > 120
        or jsonb_typeof(coalesce(entry->'pic', '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(entry->'pic', '[]'::jsonb)) > 8
        or exists (select 1 from jsonb_array_elements(coalesce(entry->'pic', '[]'::jsonb)) p
          where jsonb_typeof(p) <> 'string' or length(p #>> '{}') not between 1 and 60) then
        return jsonb_build_object('errorCode', 'invalid_input');
      end if;
    end loop;
    perform pg_advisory_xact_lock(hashtextextended('schedule:' || day::text, 0));
    -- A row a task points at is never modified, so a task always stays on the meeting it was decided on. Every other
    -- row of the day is replaced. An incoming item equal to a kept row (same start and title) is not inserted again;
    -- new rows take positions after the highest kept one.
    delete from melinda_private.schedule_items s where s.schedule_date = day
      and not exists (select 1 from melinda_private.instructions i where i.schedule_item_id = s.id);
    select coalesce(max(position), 0) into position_index from melinda_private.schedule_items where schedule_date = day;
    for entry in select value from jsonb_array_elements(args->'items') loop
      if not exists (select 1 from melinda_private.schedule_items k where k.schedule_date = day
        and k.start_time = entry->>'start' and k.title = entry->>'title') then
        position_index := position_index + 1;
        insert into melinda_private.schedule_items(schedule_date, position, start_time, end_time, title, place, pic, producer)
        values (day, position_index, entry->>'start', entry->>'end', entry->>'title', entry->>'place',
          coalesce(entry->'pic', '[]'::jsonb), args->>'producer');
      end if;
    end loop;
    return jsonb_build_object('date', day,
      'count', (select count(*) from melinda_private.schedule_items where schedule_date = day));

  elsif command = 'schedule_list' then
    day := (args->>'date')::date;
    select jsonb_agg(jsonb_build_object('id', s.id, 'date', s.schedule_date, 'position', s.position, 'start', s.start_time,
      'end', s.end_time, 'title', s.title, 'place', s.place, 'pic', s.pic, 'producer', s.producer, 'createdAt', s.created_at,
      'taskIds', coalesce((select jsonb_agg(i.id order by i.created_at) from melinda_private.instructions i
        where i.schedule_item_id = s.id), '[]'::jsonb)) order by s.start_time, s.position)
      into result from melinda_private.schedule_items s where s.schedule_date = day;
    return jsonb_build_object('date', day, 'items', coalesce(result, '[]'::jsonb));

  elsif command = 'reply_add' then
    begin
      received := (args->>'receivedAt')::timestamptz;
    exception when others then
      return jsonb_build_object('errorCode', 'invalid_input');
    end;
    if received is null
      or coalesce(args->>'key', '') = '' or length(args->>'key') > 200
      or coalesce(args->>'instructionId', '') = ''
      or coalesce(btrim(args->>'fromName'), '') = '' or length(args->>'fromName') > 120
      or coalesce(length(args->>'originalText'), 0) not between 1 and 4000
      or jsonb_typeof(coalesce(args->'attachments', '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(args->'attachments', '[]'::jsonb)) > 10
      or length(args->>'summary') > 400 or length(args->>'needs') > 280
      or coalesce(args->>'classifiedStatus', '') not in ('diterima_pic','dikerjakan','selesai','terkendala','perlu_dibaca')
      or (args->>'classifiedStatus' = 'terkendala' and coalesce(btrim(args->>'summary'), '') = '')
      or (args->'confidence' is not null and jsonb_typeof(args->'confidence') <> 'null'
        and (jsonb_typeof(args->'confidence') <> 'number' or (args->>'confidence')::numeric not between 0 and 1))
      or coalesce(btrim(args->>'producer'), '') = '' or length(args->>'producer') > 60 then
      return jsonb_build_object('errorCode', 'invalid_input');
    end if;
    perform pg_advisory_xact_lock(hashtextextended('reply:' || (args->>'key'), 0));
    select * into reply from melinda_private.staff_replies where request_key = args->>'key';
    if found then
      if reply.instruction_id <> args->>'instructionId' then return jsonb_build_object('errorCode', 'conflict'); end if;
      select * into item from melinda_private.instructions where id = reply.instruction_id;
      -- The status outcome of the first call is not stored; a replay reports it as unknown (null).
      return jsonb_build_object('reply', melinda_private.staff_reply_json(reply), 'replayed', true, 'statusApplied', null,
        'instruction', melinda_private.instruction_json(item));
    end if;
    if not exists (select 1 from melinda_private.instructions where id = args->>'instructionId') then
      return jsonb_build_object('errorCode', 'not_found');
    end if;
    insert into melinda_private.staff_replies(instruction_id, request_key, received_at, from_name, original_text, attachments,
      summary, needs, classified_status, confidence, producer)
    values (args->>'instructionId', args->>'key', received, args->>'fromName', args->>'originalText',
      coalesce(args->'attachments', '[]'::jsonb), args->>'summary', args->>'needs', args->>'classifiedStatus',
      (args->>'confidence')::numeric, args->>'producer')
    returning * into reply;
    status_applied := false;
    if reply.classified_status <> 'perlu_dibaca' then
      -- One transition authority: the same rules as melinda_director_instructions('advance'). The history note is the
      -- summary on one line and at most 280 characters (the advance limit); the full summary stays on the reply row.
      if reply.classified_status = 'terkendala' then
        history_note := left(btrim(regexp_replace(reply.summary, '[[:cntrl:]]+', ' ', 'g')), 280);
        advanced := public.melinda_director_instructions('advance', jsonb_build_object('id', reply.instruction_id,
          'status', reply.classified_status, 'actor', reply.producer, 'note', history_note));
      else
        advanced := public.melinda_director_instructions('advance', jsonb_build_object('id', reply.instruction_id,
          'status', reply.classified_status, 'actor', reply.producer));
      end if;
      if advanced ? 'errorCode' then
        if advanced->>'errorCode' <> 'conflict' then
          raise exception 'reply_add: advance failed with %', advanced->>'errorCode';
        end if;
      else
        status_applied := true;
      end if;
    end if;
    select * into item from melinda_private.instructions where id = reply.instruction_id;
    return jsonb_build_object('reply', melinda_private.staff_reply_json(reply), 'replayed', false, 'statusApplied', status_applied,
      'instruction', melinda_private.instruction_json(item));

  elsif command = 'replies_list' then
    if jsonb_typeof(args->'instructionIds') is distinct from 'array' or jsonb_array_length(args->'instructionIds') > 100 then
      return jsonb_build_object('errorCode', 'invalid_input');
    end if;
    select jsonb_agg(melinda_private.staff_reply_json(r.t) order by r.instruction_id, r.received_at, r.created_at)
      into result from (select t, t.instruction_id, t.received_at, t.created_at from melinda_private.staff_replies t
        where t.instruction_id in (select jsonb_array_elements_text(args->'instructionIds'))
        order by t.instruction_id, t.received_at, t.created_at limit 2000) r;
    return jsonb_build_object('replies', coalesce(result, '[]'::jsonb));

  elsif command = 'director_status' then
    if coalesce(args->>'status', '') not in ('ditunda','dibatalkan','selesai') then
      return jsonb_build_object('errorCode', 'invalid_status');
    end if;
    if coalesce(btrim(args->>'actor'), '') = '' then return jsonb_build_object('errorCode', 'invalid_input'); end if;
    history_note := nullif(btrim(coalesce(args->>'note', '')), '');
    if history_note is not null and (length(history_note) > 280 or history_note ~ '[[:cntrl:]]') then
      return jsonb_build_object('errorCode', 'invalid_status');
    end if;
    select * into item from melinda_private.instructions where id = args->>'id' for update;
    if not found then return jsonb_build_object('errorCode', 'not_found'); end if;
    if item.status in ('selesai','ditunda','dibatalkan') then return jsonb_build_object('errorCode', 'conflict'); end if;
    update melinda_private.instructions set status = args->>'status',
      history = history || case when history_note is null
        then jsonb_build_object('status', args->>'status', 'at', clock_timestamp(), 'actor', args->>'actor')
        else jsonb_build_object('status', args->>'status', 'at', clock_timestamp(), 'actor', args->>'actor', 'note', history_note)
      end
      where id = item.id returning * into item;
    return jsonb_build_object('instruction', melinda_private.instruction_json(item));

  elsif command = 'reminder_sent' then
    begin
      at_time := (args->>'at')::timestamptz;
    exception when others then
      return jsonb_build_object('errorCode', 'invalid_input');
    end;
    if at_time is null then return jsonb_build_object('errorCode', 'invalid_input'); end if;
    update melinda_private.instructions set reminders_sent = reminders_sent + 1, last_reminder_at = at_time
      where id = args->>'id' returning * into item;
    if not found then return jsonb_build_object('errorCode', 'not_found'); end if;
    return jsonb_build_object('instruction', melinda_private.instruction_json(item));

  elsif command in ('heartbeat', 'health') then
    if command = 'heartbeat' then
      if coalesce(btrim(args->>'producer'), '') = '' or length(args->>'producer') > 60 then
        return jsonb_build_object('errorCode', 'invalid_input');
      end if;
      insert into melinda_private.agent_heartbeats(producer, seen_at) values (args->>'producer', clock_timestamp())
        on conflict (producer) do update set seen_at = excluded.seen_at;
    end if;
    select jsonb_agg(jsonb_build_object('producer', h.producer, 'seenAt', h.seen_at) order by h.producer)
      into result from melinda_private.agent_heartbeats h;
    return jsonb_build_object('heartbeats', coalesce(result, '[]'::jsonb));

  elsif command = 'board' then
    begin
      reference := (args->>'now')::timestamptz;
    exception when others then
      return jsonb_build_object('errorCode', 'invalid_input');
    end;
    if reference is null then return jsonb_build_object('errorCode', 'invalid_input'); end if;
    -- Open tasks first, so the 500-row cap can only ever drop recently finished ones.
    select jsonb_agg(melinda_private.instruction_json(b.t) || jsonb_build_object('latestReply', b.latest)
        order by b.finished, b.created_at desc)
      into result from (
        select t, t.status in ('selesai','ditunda','dibatalkan') as finished, t.created_at,
          (select melinda_private.staff_reply_json(r) from melinda_private.staff_replies r where r.instruction_id = t.id
            order by r.received_at desc, r.created_at desc limit 1) as latest
        from melinda_private.instructions t
        where not melinda_private.instruction_archived(t, reference)
        order by finished, t.created_at desc limit 500) b;
    return jsonb_build_object('instructions', coalesce(result, '[]'::jsonb));

  elsif command = 'archive' then
    begin
      reference := coalesce((args->>'now')::timestamptz, clock_timestamp());
      page_offset := coalesce((args->>'offset')::int, 0);
      if args->>'from' is not null then perform (args->>'from')::date; end if;
      if args->>'to' is not null then perform (args->>'to')::date; end if;
      perform (args->>'all')::boolean;
    exception when others then
      return jsonb_build_object('errorCode', 'invalid_input');
    end;
    if page_offset < 0 or length(args->>'q') > 200 then return jsonb_build_object('errorCode', 'invalid_input'); end if;
    pattern := case when nullif(btrim(args->>'q'), '') is null then null
      else '%' || replace(replace(replace(btrim(args->>'q'), '\', '\\'), '%', '\%'), '_', '\_') || '%' end;
    pic_pattern := case when nullif(btrim(args->>'pic'), '') is null then null
      else replace(replace(replace(btrim(args->>'pic'), '\', '\\'), '%', '\%'), '_', '\_') || '%' end;
    select jsonb_agg(melinda_private.instruction_json(a.t) || jsonb_build_object('latestReply', a.latest)
        order by a.report_date desc, a.created_at desc)
      into result from (
        select t, t.report_date, t.created_at,
          (select melinda_private.staff_reply_json(r) from melinda_private.staff_replies r where r.instruction_id = t.id
            order by r.received_at desc, r.created_at desc limit 1) as latest
        from melinda_private.instructions t
        where (coalesce((args->>'all')::boolean, false) or melinda_private.instruction_archived(t, reference))
          and (args->>'from' is null or t.report_date >= (args->>'from')::date)
          and (args->>'to' is null or t.report_date <= (args->>'to')::date)
          and (args->>'status' is null or t.status = args->>'status')
          and (pic_pattern is null or exists (select 1 from jsonb_array_elements_text(t.pic) p where p ilike pic_pattern))
          and (pattern is null or t.id ilike pattern or t.item_title ilike pattern or t.note ilike pattern
            or exists (select 1 from melinda_private.staff_replies r where r.instruction_id = t.id and r.original_text ilike pattern))
        order by t.report_date desc, t.created_at desc limit 51 offset page_offset) a;
    result := coalesce(result, '[]'::jsonb);
    return jsonb_build_object('instructions', coalesce((select jsonb_agg(e order by n) from jsonb_array_elements(result) with ordinality x(e, n) where n <= 50), '[]'::jsonb),
      'offset', page_offset, 'pageSize', 50, 'hasMore', jsonb_array_length(result) > 50);
  end if;

  return jsonb_build_object('errorCode', 'invalid_command');
end;
$$;

revoke all on function public.melinda_director_tasks(text, jsonb) from public, anon, authenticated;
grant execute on function public.melinda_director_tasks(text, jsonb) to service_role;
comment on function public.melinda_director_tasks(text, jsonb) is 'Server-only Director task store (schedule, staff replies, Director statuses, reminders, heartbeats, board, archive). No delete command.';

commit;
