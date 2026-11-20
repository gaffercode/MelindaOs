-- Dedicated QA only. Apply every migration first (202611080001_director_tasks included); all synthetic rows roll back.
begin;
do $$
declare
  base jsonb := jsonb_build_object('reviewerId','qa-reviewer','requestHash',repeat('a',64),
    'reportDate','2099-02-01','section','umum','itemId','qa-item','itemTitle','Rapat koordinasi sintetis','urgent',false,
    'action','assign','deadline','2099-02-01T16:00','pic','["Bu Sinta"]'::jsonb,'note','');
  reply jsonb := jsonb_build_object('receivedAt','2099-02-01T09:00:00Z','fromName','Bu Sinta','originalText','Siap, sedang dikerjakan',
    'attachments','[]'::jsonb,'summary',null,'needs',null,'classifiedStatus','dikerjakan','confidence',0.9,'producer','dash');
  r jsonb;
  kept_id text;
  first_id text;
  task_a text;
  task_b text;
  task_c text;
  task_d text;
  task_e text;
  ids jsonb;
begin
  -- privilege boundary
  if has_function_privilege('anon', 'public.melinda_director_tasks(text,jsonb)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.melinda_director_tasks(text,jsonb)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.melinda_director_tasks(text,jsonb)', 'EXECUTE') then
    raise exception 'Task RPC privilege boundary failed';
  end if;
  if has_table_privilege('service_role', 'melinda_private.schedule_items', 'SELECT,INSERT,UPDATE,DELETE')
    or has_table_privilege('service_role', 'melinda_private.staff_replies', 'SELECT,INSERT,UPDATE,DELETE')
    or has_table_privilege('service_role', 'melinda_private.agent_heartbeats', 'SELECT,INSERT,UPDATE,DELETE')
    or has_table_privilege('anon', 'melinda_private.staff_replies', 'SELECT') then
    raise exception 'Task table boundary failed';
  end if;

  -- no delete reachable
  r := public.melinda_director_tasks('delete', jsonb_build_object('id', 'IOC-0001'));
  if r->>'errorCode' <> 'invalid_command' then raise exception 'Unknown command accepted: %', r; end if;

  -- schedule_replace / schedule_list
  r := public.melinda_director_tasks('schedule_replace', jsonb_build_object('date','2099-02-01','producer','dash','items', jsonb_build_array(
    jsonb_build_object('start','08:00','end','09:00','title','Apel pagi','place','Aula','pic','["Bu Sinta"]'::jsonb),
    jsonb_build_object('start','10:00','end',null,'title','Visite bangsal','place',null,'pic','[]'::jsonb),
    jsonb_build_object('start','13:00','end',null,'title','Rapat keuangan','place',null,'pic','[]'::jsonb))));
  if (r->>'count')::int <> 3 then raise exception 'Schedule replace failed: %', r; end if;
  r := public.melinda_director_tasks('schedule_list', '{"date":"2099-02-01"}');
  if jsonb_array_length(r->'items') <> 3 or r->'items'->0->>'title' <> 'Apel pagi' or r->'items'->0->>'start' <> '08:00' then
    raise exception 'Schedule list failed: %', r;
  end if;
  first_id := r->'items'->0->>'id';
  kept_id := r->'items'->1->>'id';
  r := public.melinda_director_tasks('schedule_replace', jsonb_build_object('date','2099-02-01','producer','dash','items', jsonb_build_array(
    jsonb_build_object('start','25:00','end',null,'title','Bad','place',null,'pic','[]'::jsonb))));
  if r->>'errorCode' <> 'invalid_input' then raise exception 'Bad start time accepted: %', r; end if;

  -- create stores scheduleItemId and linkedId; the instruction JSON carries the new fields
  r := public.melinda_director_instructions('create', base || jsonb_build_object('key','qa-task-a','scheduleItemId', kept_id));
  task_a := r->'instruction'->>'id';
  if r->'instruction'->>'scheduleItemId' <> kept_id or r->'instruction'->'linkedId' <> 'null'::jsonb
    or (r->'instruction'->>'remindersSent')::int <> 0 or r->'instruction'->'lastReminderAt' <> 'null'::jsonb then
    raise exception 'Create did not return the task fields: %', r;
  end if;
  r := public.melinda_director_instructions('create', base || jsonb_build_object('key','qa-task-bad','scheduleItemId','not-a-uuid'));
  if r->>'errorCode' <> 'invalid_input' then raise exception 'Malformed scheduleItemId accepted: %', r; end if;
  r := public.melinda_director_instructions('create', base || jsonb_build_object('key','qa-task-b','linkedId', task_a));
  task_b := r->'instruction'->>'id';
  if r->'instruction'->>'linkedId' <> task_a then raise exception 'linkedId not stored: %', r; end if;
  r := public.melinda_director_instructions('read', jsonb_build_object('id', task_a));
  if r->'instruction'->>'scheduleItemId' <> kept_id or not (r->'instruction' ? 'remindersSent') then raise exception 'Read shape failed: %', r; end if;
  r := public.melinda_director_instructions('list', '{"date":"2099-02-01"}');
  if not (r->'instructions'->0 ? 'linkedId') or not (r->'instructions'->0 ? 'lastReminderAt') then raise exception 'List shape failed: %', r; end if;

  -- schedule_replace never modifies a linked row: a reorder keeps the task on its meeting, no duplicate of it
  r := public.melinda_director_tasks('schedule_replace', jsonb_build_object('date','2099-02-01','producer','dash','items', jsonb_build_array(
    jsonb_build_object('start','08:00','end','09:00','title','Apel pagi','place','Aula','pic','["Bu Sinta"]'::jsonb),
    jsonb_build_object('start','13:00','end',null,'title','Rapat keuangan','place',null,'pic','[]'::jsonb),
    jsonb_build_object('start','10:00','end',null,'title','Visite bangsal','place','Bangsal B','pic','["Bu Sinta"]'::jsonb))));
  if (r->>'count')::int <> 3 then raise exception 'Reorder count failed: %', r; end if;
  r := public.melinda_director_tasks('schedule_list', '{"date":"2099-02-01"}');
  if jsonb_array_length(r->'items') <> 3 then raise exception 'Reorder produced the wrong number of rows: %', r; end if;
  if (select count(*) from jsonb_array_elements(r->'items') e where e->>'title' = 'Visite bangsal') <> 1 then
    raise exception 'Visite bangsal duplicated: %', r;
  end if;
  if not exists (select 1 from jsonb_array_elements(r->'items') e where e->>'id' = kept_id and e->>'title' = 'Visite bangsal'
      and e->>'start' = '10:00' and e->'place' = 'null'::jsonb and e->'taskIds' = jsonb_build_array(task_a)) then
    raise exception 'Linked row was modified or lost its task: %', r;
  end if;
  if not exists (select 1 from jsonb_array_elements(r->'items') e where e->>'title' = 'Rapat keuangan' and e->>'id' <> kept_id
      and e->'taskIds' = '[]'::jsonb) then
    raise exception 'Rapat keuangan is not a separate row: %', r;
  end if;
  if r->'items'->0->>'title' <> 'Apel pagi' or r->'items'->1->>'id' <> kept_id or r->'items'->2->>'title' <> 'Rapat keuangan'
    or r->'items'->0->>'id' = first_id then
    raise exception 'Schedule not ordered by start time or unlinked row not replaced: %', r;
  end if;
  if (select position from melinda_private.schedule_items where id = kept_id::uuid) <> 2
    or (select min(position) from melinda_private.schedule_items where schedule_date = '2099-02-01' and id <> kept_id::uuid) <= 2 then
    raise exception 'New rows did not take positions after the kept row';
  end if;
  r := public.melinda_director_tasks('schedule_replace', jsonb_build_object('date','2099-02-01','producer','dash','items','[]'::jsonb));
  r := public.melinda_director_tasks('schedule_list', '{"date":"2099-02-01"}');
  if jsonb_array_length(r->'items') <> 1 or r->'items'->0->>'id' <> kept_id then raise exception 'Linked row lost on an empty replace: %', r; end if;

  -- reply_add is idempotent on key
  perform public.melinda_director_instructions('advance', jsonb_build_object('id', task_a, 'status', 'diteruskan', 'actor', 'dash'));
  r := public.melinda_director_tasks('reply_add', reply || jsonb_build_object('instructionId', task_a, 'key', 'reply:' || task_a || ':m1'));
  if r->>'replayed' <> 'false' or r->>'statusApplied' <> 'true' or r->'reply'->>'originalText' <> 'Siap, sedang dikerjakan'
    or r->'instruction'->>'status' <> 'dikerjakan' then
    raise exception 'First reply failed: %', r;
  end if;
  r := public.melinda_director_tasks('reply_add', reply || jsonb_build_object('instructionId', task_a, 'key', 'reply:' || task_a || ':m1'));
  if r->>'replayed' <> 'true' or r->'reply'->>'originalText' <> 'Siap, sedang dikerjakan' then raise exception 'Replay failed: %', r; end if;
  if (select count(*) from melinda_private.staff_replies where request_key = 'reply:' || task_a || ':m1') <> 1 then raise exception 'Replay created a second row'; end if;
  r := public.melinda_director_tasks('reply_add', reply || jsonb_build_object('instructionId', task_b, 'key', 'reply:' || task_a || ':m1'));
  if r->>'errorCode' <> 'conflict' then raise exception 'Reused key on another task accepted: %', r; end if;
  r := public.melinda_director_tasks('reply_add', reply || jsonb_build_object('instructionId', 'IOC-9999', 'key', 'reply:IOC-9999:m1'));
  if r->>'errorCode' <> 'not_found' then raise exception 'Reply on a missing task accepted: %', r; end if;
  r := public.melinda_director_tasks('reply_add', reply || jsonb_build_object('instructionId', task_a, 'key', 'reply:' || task_a || ':m0', 'classifiedStatus', 'bingung'));
  if r->>'errorCode' <> 'invalid_input' then raise exception 'Unknown classified status accepted: %', r; end if;

  -- a terkendala reply advances the status with the summary as the history note
  r := public.melinda_director_tasks('reply_add', reply || jsonb_build_object('instructionId', task_a, 'key', 'reply:' || task_a || ':m2',
    'originalText', 'Printer di bangsal rusak, belum bisa cetak', 'classifiedStatus', 'terkendala', 'summary', 'Printer bangsal rusak', 'needs', 'Printer pengganti'));
  if r->>'statusApplied' <> 'true' or r->'instruction'->>'status' <> 'terkendala'
    or r->'instruction'->'history'->-1->>'note' <> 'Printer bangsal rusak' or r->'instruction'->'history'->-1->>'actor' <> 'dash' then
    raise exception 'Terkendala reply did not advance: %', r;
  end if;

  -- perlu_dibaca stores the reply but changes nothing
  r := public.melinda_director_tasks('reply_add', reply || jsonb_build_object('instructionId', task_a, 'key', 'reply:' || task_a || ':m3',
    'originalText', '??', 'classifiedStatus', 'perlu_dibaca', 'confidence', 0.3));
  if r->>'statusApplied' <> 'false' or r->'instruction'->>'status' <> 'terkendala' then raise exception 'perlu_dibaca changed the status: %', r; end if;

  -- replies_list
  r := public.melinda_director_tasks('replies_list', jsonb_build_object('instructionIds', jsonb_build_array(task_a, task_b)));
  if jsonb_array_length(r->'replies') <> 3 then raise exception 'Replies list failed: %', r; end if;
  select jsonb_agg('IOC-' || g) into ids from generate_series(1, 101) g;
  r := public.melinda_director_tasks('replies_list', jsonb_build_object('instructionIds', ids));
  if r->>'errorCode' <> 'invalid_input' then raise exception 'More than 100 ids accepted: %', r; end if;

  -- director_status: Director-final statuses; a reply on a dibatalkan task is stored without a status change
  r := public.melinda_director_tasks('director_status', jsonb_build_object('id', task_b, 'status', 'dibatalkan', 'actor', 'qa-reviewer', 'note', 'Tidak diperlukan lagi'));
  if r->'instruction'->>'status' <> 'dibatalkan' or r->'instruction'->'history'->-1->>'note' <> 'Tidak diperlukan lagi'
    or r->'instruction'->'history'->-1->>'actor' <> 'qa-reviewer' then
    raise exception 'director_status failed: %', r;
  end if;
  r := public.melinda_director_tasks('director_status', jsonb_build_object('id', task_b, 'status', 'ditunda', 'actor', 'qa-reviewer'));
  if r->>'errorCode' <> 'conflict' then raise exception 'director_status from a final status accepted: %', r; end if;
  r := public.melinda_director_tasks('director_status', jsonb_build_object('id', task_a, 'status', 'dikerjakan', 'actor', 'qa-reviewer'));
  if r->>'errorCode' <> 'invalid_status' then raise exception 'director_status accepted a non-Director status: %', r; end if;
  r := public.melinda_director_tasks('reply_add', reply || jsonb_build_object('instructionId', task_b, 'key', 'reply:' || task_b || ':m1'));
  if r->>'statusApplied' <> 'false' or r->>'replayed' <> 'false' or r->'instruction'->>'status' <> 'dibatalkan' then
    raise exception 'Reply on a dibatalkan task changed the status: %', r;
  end if;
  if (select count(*) from melinda_private.staff_replies where request_key = 'reply:' || task_b || ':m1') <> 1 then raise exception 'Reply on a dibatalkan task not stored'; end if;
  r := public.melinda_director_instructions('advance', jsonb_build_object('id', task_b, 'status', 'selesai', 'actor', 'dash'));
  if r->>'errorCode' <> 'conflict' then raise exception 'Advance revived a dibatalkan task: %', r; end if;

  -- reminder bookkeeping
  r := public.melinda_director_tasks('reminder_sent', jsonb_build_object('id', task_a, 'at', '2099-02-02T09:00:00Z'));
  r := public.melinda_director_tasks('reminder_sent', jsonb_build_object('id', task_a, 'at', '2099-02-03T09:00:00Z'));
  if (r->'instruction'->>'remindersSent')::int <> 2 or (r->'instruction'->>'lastReminderAt')::timestamptz <> '2099-02-03T09:00:00Z'::timestamptz then
    raise exception 'Reminder bookkeeping failed: %', r;
  end if;
  r := public.melinda_director_tasks('reminder_sent', jsonb_build_object('id', 'IOC-9999', 'at', '2099-02-03T09:00:00Z'));
  if r->>'errorCode' <> 'not_found' then raise exception 'Reminder on a missing task accepted: %', r; end if;

  -- heartbeat / health
  r := public.melinda_director_tasks('heartbeat', '{"producer":"dash"}');
  r := public.melinda_director_tasks('heartbeat', '{"producer":"dash"}');
  r := public.melinda_director_tasks('health', '{}');
  if jsonb_array_length(r->'heartbeats') <> 1 or r->'heartbeats'->0->>'producer' <> 'dash' or r->'heartbeats'->0->>'seenAt' is null then
    raise exception 'Health failed: %', r;
  end if;

  -- open excludes Director-final statuses
  r := public.melinda_director_instructions('open', '{"from":"2099-01-31","to":"2099-02-01"}');
  if exists (select 1 from jsonb_array_elements(r->'instructions') e where e->>'id' = task_b) or not exists (select 1 from jsonb_array_elements(r->'instructions') e where e->>'id' = task_a) then
    raise exception 'Open did not exclude dibatalkan: %', r;
  end if;

  -- board and archive. task_a: terkendala, 60 days old -> board. task_c: selesai 8 days ago -> archive.
  -- task_d: ditunda 6 days ago -> board. task_b: dibatalkan 1 day ago -> board.
  update melinda_private.instructions set history = history || jsonb_build_array(jsonb_build_object('status','dibatalkan','at','2099-03-01T00:00:00Z','actor','qa-reviewer'))
    where id = task_b;
  update melinda_private.instructions set history = jsonb_build_array(jsonb_build_object('status','terkendala','at','2099-01-01T00:00:00Z','actor','dash'))
    where id = task_a;
  r := public.melinda_director_instructions('create', base || jsonb_build_object('key','qa-task-c','itemTitle','Laporan mutu sintetis','pic','["Pak Budi"]'::jsonb));
  task_c := r->'instruction'->>'id';
  perform public.melinda_director_tasks('director_status', jsonb_build_object('id', task_c, 'status', 'selesai', 'actor', 'qa-reviewer'));
  update melinda_private.instructions set history = history || jsonb_build_array(jsonb_build_object('status','selesai','at','2099-02-22T00:00:00Z','actor','qa-reviewer'))
    where id = task_c;
  r := public.melinda_director_instructions('create', base || jsonb_build_object('key','qa-task-d'));
  task_d := r->'instruction'->>'id';
  perform public.melinda_director_tasks('director_status', jsonb_build_object('id', task_d, 'status', 'ditunda', 'actor', 'qa-reviewer'));
  update melinda_private.instructions set history = history || jsonb_build_array(jsonb_build_object('status','ditunda','at','2099-02-24T00:00:00Z','actor','qa-reviewer'))
    where id = task_d;
  r := public.melinda_director_tasks('board', '{"now":"2099-03-02T00:00:00Z"}');
  if not exists (select 1 from jsonb_array_elements(r->'instructions') e where e->>'id' = task_a and e->'latestReply'->>'originalText' = '??')
    or not exists (select 1 from jsonb_array_elements(r->'instructions') e where e->>'id' = task_d and e->'latestReply' = 'null'::jsonb)
    or not exists (select 1 from jsonb_array_elements(r->'instructions') e where e->>'id' = task_b)
    or exists (select 1 from jsonb_array_elements(r->'instructions') e where e->>'id' = task_c) then
    raise exception 'Board failed: %', r;
  end if;
  r := public.melinda_director_tasks('archive', '{"now":"2099-03-02T00:00:00Z","from":"2099-01-01","to":"2099-12-31","offset":0}');
  if jsonb_array_length(r->'instructions') <> 1 or r->'instructions'->0->>'id' <> task_c or not (r->'instructions'->0 ? 'latestReply') then
    raise exception 'Archive did not exclude open tasks: %', r;
  end if;
  -- all=true ignores the archive rule: open, recent and old records of the range are all returned
  r := public.melinda_director_tasks('archive', '{"now":"2099-03-02T00:00:00Z","from":"2099-01-01","to":"2099-12-31","all":true,"offset":0}');
  if not exists (select 1 from jsonb_array_elements(r->'instructions') e where e->>'id' = task_a)
    or not exists (select 1 from jsonb_array_elements(r->'instructions') e where e->>'id' = task_b)
    or not exists (select 1 from jsonb_array_elements(r->'instructions') e where e->>'id' = task_c)
    or not exists (select 1 from jsonb_array_elements(r->'instructions') e where e->>'id' = task_d) then
    raise exception 'Archive all=true missed records: %', r;
  end if;
  r := public.melinda_director_tasks('archive', '{"now":"2099-03-02T00:00:00Z","from":"2099-01-01","to":"2099-12-31","all":false,"offset":0}');
  if jsonb_array_length(r->'instructions') <> 1 then raise exception 'Archive all=false changed: %', r; end if;
  r := public.melinda_director_tasks('archive', '{"now":"2099-03-02T00:00:00Z","all":"nope","offset":0}');
  if r->>'errorCode' <> 'invalid_input' then raise exception 'Archive bad all accepted: %', r; end if;
  -- a "Tandai selesai" record (action done) is always archive, whatever its status or age
  r := public.melinda_director_instructions('create', base || jsonb_build_object('key','qa-task-done','action','done','itemTitle','Catatan selesai sintetis','pic','["Pak Andi"]'::jsonb));
  task_e := r->'instruction'->>'id';
  r := public.melinda_director_tasks('board', '{"now":"2099-03-02T00:00:00Z"}');
  if exists (select 1 from jsonb_array_elements(r->'instructions') e where e->>'id' = task_e) then raise exception 'Board lists an action-done record: %', r; end if;
  r := public.melinda_director_tasks('archive', '{"now":"2099-03-02T00:00:00Z","q":"Catatan selesai","offset":0}');
  if jsonb_array_length(r->'instructions') <> 1 or r->'instructions'->0->>'id' <> task_e then raise exception 'Archive misses an action-done record: %', r; end if;
  r := public.melinda_director_tasks('archive', '{"now":"2099-03-02T00:00:00Z","status":"selesai","q":"Catatan selesai","offset":0}');
  if jsonb_array_length(r->'instructions') <> 0 then raise exception 'Archive status filter ignored for an action-done record: %', r; end if;
  r := public.melinda_director_tasks('archive', '{"now":"2099-03-02T00:00:00Z","q":"MUTU","offset":0}');
  if jsonb_array_length(r->'instructions') <> 1 then raise exception 'Archive q failed: %', r; end if;
  r := public.melinda_director_tasks('archive', '{"now":"2099-03-02T00:00:00Z","pic":"Bu Sinta","offset":0}');
  if jsonb_array_length(r->'instructions') <> 0 then raise exception 'Archive pic filter failed: %', r; end if;
  -- q also matches the task code, case-insensitively
  r := public.melinda_director_tasks('archive', jsonb_build_object('now','2099-03-02T00:00:00Z','q',lower(task_c),'offset',0));
  if jsonb_array_length(r->'instructions') <> 1 or r->'instructions'->0->>'id' <> task_c then raise exception 'Archive q by task code failed: %', r; end if;
  -- pic is a case-insensitive prefix match against any PIC entry, with %/_ escaped
  r := public.melinda_director_tasks('archive', '{"now":"2099-03-02T00:00:00Z","pic":"pak b","offset":0}');
  if jsonb_array_length(r->'instructions') <> 1 or r->'instructions'->0->>'id' <> task_c then raise exception 'Archive pic prefix failed: %', r; end if;
  r := public.melinda_director_tasks('archive', '{"now":"2099-03-02T00:00:00Z","pic":"udi","offset":0}');
  if jsonb_array_length(r->'instructions') <> 0 then raise exception 'Archive pic matched a non-prefix: %', r; end if;
  r := public.melinda_director_tasks('archive', '{"now":"2099-03-02T00:00:00Z","pic":"%","offset":0}');
  if jsonb_array_length(r->'instructions') <> 0 then raise exception 'Archive pic wildcard not escaped: %', r; end if;
  r := public.melinda_director_tasks('archive', '{"now":"2099-03-02T00:00:00Z","pic":"_","offset":0}');
  if jsonb_array_length(r->'instructions') <> 0 then raise exception 'Archive pic underscore not escaped: %', r; end if;
  r := public.melinda_director_tasks('archive', '{"now":"2099-03-02T00:00:00Z","status":"dibatalkan","offset":0}');
  if jsonb_array_length(r->'instructions') <> 0 then raise exception 'Archive status filter failed: %', r; end if;
  -- the reply text is searchable once the task is archived
  perform public.melinda_director_tasks('reply_add', reply || jsonb_build_object('instructionId', task_c, 'key', 'reply:' || task_c || ':m1',
    'originalText', 'Laporan sudah dikirim ke email 100%', 'classifiedStatus', 'selesai'));
  r := public.melinda_director_tasks('archive', '{"now":"2099-03-02T00:00:00Z","q":"email 100%","offset":0}');
  if jsonb_array_length(r->'instructions') <> 1 or r->'instructions'->0->'latestReply'->>'originalText' <> 'Laporan sudah dikirim ke email 100%' then
    raise exception 'Archive reply-text search failed: %', r;
  end if;
  r := public.melinda_director_tasks('archive', '{"now":"2099-03-02T00:00:00Z","q":"%","offset":0}');
  if jsonb_array_length(r->'instructions') <> 1 then raise exception 'Archive q wildcard not escaped: %', r; end if;
  r := public.melinda_director_tasks('archive', '{"now":"2099-03-02T00:00:00Z","q":"_","offset":0}');
  if jsonb_array_length(r->'instructions') <> 0 then raise exception 'Archive q underscore not escaped: %', r; end if;
  r := public.melinda_director_tasks('archive', '{"now":"2099-03-02T00:00:00Z","offset":-1}');
  if r->>'errorCode' <> 'invalid_input' then raise exception 'Negative offset accepted: %', r; end if;
end;
$$;
rollback;
