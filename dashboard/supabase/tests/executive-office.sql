-- Synthetic acceptance tests for Executive Office (all data rolled back).
begin;
do $$
declare
  start_time timestamptz := clock_timestamp() + interval '1 hour';
  updated_time timestamptz := clock_timestamp();
  body jsonb;
  result jsonb;
  task_id text;
  key text;
  day text;
begin
  if has_function_privilege('anon','public.melinda_executive_office(text,jsonb)','EXECUTE')
    or has_function_privilege('authenticated','public.melinda_executive_office(text,jsonb)','EXECUTE')
    or not has_function_privilege('service_role','public.melinda_executive_office(text,jsonb)','EXECUTE')
    or has_table_privilege('service_role','melinda_private.executive_calendar','SELECT')
    or has_table_privilege('service_role','melinda_private.task_archive_receipts','SELECT') then
    raise exception 'Executive office security boundary failed';
  end if;
  body := jsonb_build_object(
    'owner','director','kind','meeting','eventId','qa-director-1','meetingId','qa-meeting-1',
    'sourceUpdatedAt',updated_time,'startAt',start_time,'endAt',start_time + interval '1 hour',
    'title','Rapat keuangan sintetis','place','Ruang direksi','participants',jsonb_build_array('Bu Yuni'),
    'department','Keuangan','visibility','normal','status','confirmed','sharedWithNovia',true,'producer','dash');
  result := public.melinda_executive_office('calendar_upsert',body);
  if result->>'replayed' <> 'false' then raise exception 'Initial ingest failed: %',result; end if;
  result := public.melinda_executive_office('calendar_upsert',body);
  if result->>'replayed' <> 'true' then raise exception 'Replay not idempotent: %',result; end if;
  result := public.melinda_executive_office('calendar_upsert',body || jsonb_build_object('sourceUpdatedAt',updated_time - interval '5 minutes'));
  if result->>'errorCode' <> 'conflict' then raise exception 'Stale calendar write accepted: %',result; end if;
  result := public.melinda_executive_office('queue','{}');
  if (select count(*) from jsonb_array_elements(result->'items') v where v->>'meetingId' = 'qa-meeting-1') <> 1 then
    raise exception 'Shared calendar sync gate failed: %',result;
  end if;
  result := public.melinda_executive_office('calendar_upsert',
    body || jsonb_build_object('owner','novia','eventId','qa-novia-1','title','Sibuk',
      'participants','[]'::jsonb,'department',null,'place',null,'visibility','busy'));
  if result->>'replayed' <> 'false' then raise exception 'Novia ingest failed: %',result; end if;
  result := public.melinda_executive_office('queue','{}');
  if (select count(*) from jsonb_array_elements(result->'items') v where v->>'meetingId' = 'qa-meeting-1') <> 2 then
    raise exception 'Department invitation not queued: %',result;
  end if;
  select v->>'key' into key from jsonb_array_elements(result->'items') v where v->>'kind' = 'department_invitation' and v->>'meetingId'='qa-meeting-1';
  if key is null then raise exception 'Missing department invitation'; end if;
  result := public.melinda_executive_office('delivery_ack',
    jsonb_build_object('key',key,'state','sent','messageId','qa-wa-1','note','Konfirmasi terkirim'));
  if result->>'state' <> 'sent' then raise exception 'Delivery receipt failed: %',result; end if;
  result := public.melinda_executive_office('delivery_ack',
    jsonb_build_object('key',key,'state','sent','messageId','qa-wa-1','note','Konfirmasi terkirim'));
  if result->>'replayed' <> 'true' then raise exception 'Delivery receipt replay failed: %',result; end if;
  result := public.melinda_executive_office('readiness_update',
    '{"meetingId":"qa-meeting-1","item":"room","state":"ready","evidence":"Ruang terverifikasi","messageId":"qa-wa-2"}');
  if result->>'recorded' <> 'true' then raise exception 'Readiness receipt failed: %',result; end if;
  result := public.melinda_executive_office('meeting_close',
    '{"meetingId":"qa-meeting-1","outcome":"Keputusan uji","minutesUrl":null,"messageId":"qa-wa-3"}');
  if result->>'archived' <> 'true' then raise exception 'Meeting archive failed: %',result; end if;
  day := (start_time at time zone 'Asia/Jakarta')::date::text;
  result := public.melinda_executive_office('plan',jsonb_build_object('date',day));
  if (select count(*) from jsonb_array_elements(result->'events') e where e->>'meetingId' = 'qa-meeting-1') <> 2
    or (select count(*) from jsonb_array_elements(result->'readiness') e where e->>'meetingId'='qa-meeting-1') <> 1
    or (select count(*) from jsonb_array_elements(result->'archives') e where e->>'meetingId'='qa-meeting-1') <> 1 then
    raise exception 'Director plan missing inputs/evidence/archive: %',result;
  end if;
  result := public.melinda_director_instructions('create',jsonb_build_object(
    'reviewerId','qa-executive','key','qa-archive-exec','requestHash',repeat('a',64),
    'reportDate',day,'section','umum','itemId','qa-exec','itemTitle','Tugas sintetis',
    'urgent',false,'action','assign','deadline',null,'pic','[]'::jsonb,'note',''));
  task_id := result->'instruction'->>'id';
  if task_id is null then raise exception 'Could not create synthetic task: %',result; end if;
  update melinda_private.instructions set status = 'selesai' where id = task_id;
  if not exists(select 1 from melinda_private.task_archive_receipts where instruction_id = task_id and final_status = 'selesai') then
    raise exception 'Completed task did not receive immutable archive receipt';
  end if;
end;
$$;
rollback;
