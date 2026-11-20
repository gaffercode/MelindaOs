-- Director tasks: optional schedule `topic` for the home-table follow-up column.
-- SUPPLY ONLY. Apply in the Supabase SQL Editor after every prior migration
-- (202611080001_director_tasks and later), before deploying the dashboard build
-- that sends/reads `topic`. Until applied, the live contract stays without `topic`
-- and producers must not send it.
--
-- Change: melinda_private.schedule_items gains `topic` (optional, max 300 chars,
-- matching the dashboard contract bound that fits the 79-288 char canonical
-- 2026-11-09 follow-ups). `schedule_replace` accepts/stores it, `schedule_list`
-- returns it. Everything else is untouched: append-only history, privacy boundary
-- (no delete command; linked rows never modified), least-privilege grants, and the
-- 1-40 item / 200-char title / 120-char place / 8-PIC bounds.
begin;

alter table melinda_private.schedule_items
  add column if not exists topic text check (length(topic) <= 300);

create or replace function public.melinda_director_tasks(command text, args jsonb)
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
        or length(entry->>'topic') > 300
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
        insert into melinda_private.schedule_items(schedule_date, position, start_time, end_time, title, place, topic, pic, producer)
        values (day, position_index, entry->>'start', entry->>'end', entry->>'title', entry->>'place', entry->>'topic',
          coalesce(entry->'pic', '[]'::jsonb), args->>'producer');
      end if;
    end loop;
    return jsonb_build_object('date', day,
      'count', (select count(*) from melinda_private.schedule_items where schedule_date = day));

  elsif command = 'schedule_list' then
    day := (args->>'date')::date;
    select jsonb_agg(jsonb_build_object('id', s.id, 'date', s.schedule_date, 'position', s.position, 'start', s.start_time,
      'end', s.end_time, 'title', s.title, 'place', s.place, 'topic', s.topic, 'pic', s.pic, 'producer', s.producer, 'createdAt', s.created_at,
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

commit;
