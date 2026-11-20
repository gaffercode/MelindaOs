-- Dedicated QA only. Apply 202611060001_daily_pipeline.sql first; all synthetic rows roll back.
begin;
do $$
declare
  registry jsonb := '{"timezone":"Asia/Jakarta","schedules":{"collect":"06:30","prepare":"07:45","publish":"07:50","alert":"09:00","revisions":["12:00","16:00"]},"sources":[{"id":"sdm","label":"SDM","kind":"unit_report","required":true,"period":"previous_day","section":"staffing","picRelayTarget":"relay:sdm","numericFields":[]}]}';
  report jsonb := '{"sourceId":"sdm","reportDate":"2099-01-02","periodDate":"2099-01-01","observedAt":"2099-01-02T06:30:00+07:00","availability":"no_issues","issues":"Tidak ada kendala","followUp":"","decisionNeeded":"","metrics":{}}';
  result jsonb;
  first_claim jsonb;
  second_claim jsonb;
  run_id uuid;
  morning_id uuid;
  delayed_id uuid;
  noon_id uuid;
  pinned_generation bigint;
begin
  if has_function_privilege('anon', 'public.melinda_daily_pipeline(text,jsonb)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.melinda_daily_pipeline(text,jsonb)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.melinda_daily_pipeline(text,jsonb)', 'EXECUTE') then
    raise exception 'Pipeline RPC privilege boundary failed';
  end if;
  if has_table_privilege('service_role', 'melinda_private.daily_source_reports', 'SELECT,INSERT,UPDATE,DELETE')
    or has_table_privilege('service_role', 'melinda_private.daily_pipeline_runs', 'SELECT,INSERT,UPDATE,DELETE')
    or has_table_privilege('service_role', 'melinda_private.daily_alert_deliveries', 'SELECT,INSERT,UPDATE,DELETE') then
    raise exception 'Pipeline table boundary failed';
  end if;

  result := public.melinda_daily_pipeline('snapshot_registry', jsonb_build_object('reportDate','2099-01-02','registry',registry,'registryHash',repeat('a',64)));
  if result->>'replayed' <> 'false' then raise exception 'Registry snapshot was not created'; end if;
  result := public.melinda_daily_pipeline('snapshot_registry', jsonb_build_object('reportDate','2099-01-02','registry',registry,'registryHash',repeat('b',64)));
  if result->>'errorCode' <> 'conflict' then raise exception 'Registry mutation was accepted'; end if;

  result := public.melinda_daily_pipeline('invite', jsonb_build_object('reportDate','2099-01-02','sourceId','sdm','capabilityHash',repeat('c',64),'expiresAt','2099-01-02T17:00:00Z'));
  run_id := (result->>'runId')::uuid;
  result := public.melinda_daily_pipeline('invite', jsonb_build_object('reportDate','2099-01-02','sourceId','sdm','capabilityHash',repeat('d',64),'expiresAt','2099-01-02T17:00:00Z'));
  if result->>'errorCode' <> 'conflict' then raise exception 'Existing invitation capability rotated'; end if;
  result := public.melinda_daily_pipeline('exchange_capability', jsonb_build_object('capabilityHash',repeat('d',64),'now','2099-01-02T01:00:00Z'));
  if result->>'errorCode' <> 'invalid_capability' then raise exception 'Wrong capability accepted'; end if;
  result := public.melinda_daily_pipeline('exchange_capability', jsonb_build_object('capabilityHash',repeat('c',64),'now','2099-01-02T01:00:00Z'));
  if result->>'sourceId' <> 'sdm' or result->>'reportDate' <> '2099-01-02' then raise exception 'Capability scope lost'; end if;

  result := public.melinda_daily_pipeline('submit_report', jsonb_build_object('capabilityHash',repeat('c',64),'input',report,'contentHash',repeat('e',64),'now','2099-01-02T01:00:00Z'));
  if result->>'replayed' <> 'false' or result->>'revision' <> '1' then raise exception 'First report not stored'; end if;
  result := public.melinda_daily_pipeline('submit_report', jsonb_build_object('capabilityHash',repeat('c',64),'input',report,'contentHash',repeat('e',64),'now','2099-01-02T01:00:01Z'));
  if result->>'replayed' <> 'true' or result->>'revision' <> '1' then raise exception 'Report replay created a revision'; end if;
  result := public.melinda_daily_pipeline('submit_report', jsonb_build_object('capabilityHash',repeat('c',64),'input',report || '{"sourceId":"other"}','contentHash',repeat('f',64),'now','2099-01-02T01:00:02Z'));
  if result->>'errorCode' <> 'invalid_scope' then raise exception 'Capability crossed source scope'; end if;
  result := public.melinda_daily_pipeline('latest_reports', '{"reportDate":"2099-01-02"}');
  pinned_generation := (result->>'generation')::bigint;

  result := public.melinda_daily_pipeline('schedule', '{"reportDate":"2099-01-02","phase":"morning","publicationOrder":1,"semanticHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}');
  run_id := (result->>'runId')::uuid;
  first_claim := public.melinda_daily_pipeline('claim', jsonb_build_object('runId',run_id,'owner','worker-a','now','2099-01-02T00:45:00Z','leaseSeconds',180));
  second_claim := public.melinda_daily_pipeline('claim', jsonb_build_object('runId',run_id,'owner','worker-b','now','2099-01-02T00:45:01Z','leaseSeconds',180));
  if first_claim->>'claimed' <> 'true' or second_claim->>'claimed' <> 'false' then raise exception 'Concurrent lease produced more than one owner'; end if;
  second_claim := public.melinda_daily_pipeline('claim', jsonb_build_object('runId',run_id,'owner','worker-b','now','2099-01-02T00:49:00Z','leaseSeconds',180));
  if second_claim->>'claimed' <> 'true' or (second_claim->>'fencingToken')::bigint <= (first_claim->>'fencingToken')::bigint then raise exception 'Expired lease did not advance fence'; end if;
  result := public.melinda_daily_pipeline('prepare', jsonb_build_object('runId',run_id,'owner','worker-a','fencingToken',(first_claim->>'fencingToken')::bigint,'sourceGeneration',pinned_generation,'manifest','{}'::jsonb,'payload','{}'::jsonb,'payloadHash',repeat('1',64),'key','morning-2099-01-02','now','2099-01-02T00:49:01Z'));
  if result->>'errorCode' <> 'stale_lease' then raise exception 'Stale fence prepared a payload'; end if;
  result := public.melinda_daily_pipeline('prepare', jsonb_build_object('runId',run_id,'owner','worker-b','fencingToken',(second_claim->>'fencingToken')::bigint,'sourceGeneration',pinned_generation,'manifest','{}'::jsonb,'payload','{"dateIso":"2099-01-02"}'::jsonb,'payloadHash',repeat('2',64),'key','morning-2099-01-02','now','2099-01-02T00:49:01Z'));
  if result->>'prepared' is distinct from 'true' then raise exception 'Current owner failed to prepare: %', result; end if;
  result := public.melinda_daily_pipeline('publish', jsonb_build_object('runId',run_id,'owner','worker-b','fencingToken',(second_claim->>'fencingToken')::bigint,'sourceGeneration',pinned_generation,'kind','management_brief','producerId','daily-pipeline','key','morning-2099-01-02','date','2099-01-02','payloadHash',repeat('2',64),'payload','{"dateIso":"2099-01-02"}'::jsonb,'now','2099-01-02T00:49:02Z'));
  if result->>'replayed' <> 'false' or result->>'date' <> '2099-01-02' then raise exception 'Atomic publish failed'; end if;
  if (select state from melinda_private.daily_pipeline_runs where id = run_id) <> 'published' then raise exception 'Run not finalized: state %, result %', (select state from melinda_private.daily_pipeline_runs where id = run_id), result; end if;
  if (select count(*) from melinda_private.daily_documents where pipeline_run_id = run_id) <> 1 then raise exception 'Document not committed with run'; end if;

  -- A report received after the 07:45 freeze cannot invalidate the prepared morning body.
  result := public.melinda_daily_pipeline('snapshot_registry', jsonb_build_object('reportDate','2099-02-02','registry',registry,'registryHash',repeat('3',64)));
  result := public.melinda_daily_pipeline('invite', jsonb_build_object('reportDate','2099-02-02','sourceId','sdm','capabilityHash',repeat('4',64),'expiresAt','2099-02-02T17:00:00Z'));
  result := public.melinda_daily_pipeline('submit_report', jsonb_build_object('capabilityHash',repeat('4',64),'input',report || '{"reportDate":"2099-02-02","periodDate":"2099-02-01"}','contentHash',repeat('5',64),'now','2099-02-02T00:30:00Z'));
  result := public.melinda_daily_pipeline('latest_reports', '{"reportDate":"2099-02-02"}');
  pinned_generation := (result->>'generation')::bigint;
  result := public.melinda_daily_pipeline('schedule', jsonb_build_object('reportDate','2099-02-02','phase','morning','publicationOrder',1,'semanticHash',repeat('6',64)));
  morning_id := (result->>'runId')::uuid;
  first_claim := public.melinda_daily_pipeline('claim', jsonb_build_object('runId',morning_id,'owner','worker-a','now','2099-02-02T00:45:00Z','leaseSeconds',300));
  result := public.melinda_daily_pipeline('prepare', jsonb_build_object('runId',morning_id,'owner','worker-a','fencingToken',(first_claim->>'fencingToken')::bigint,'sourceGeneration',pinned_generation,'manifest','{}','payload','{"dateIso":"2099-02-02","revision":1}','payloadHash',repeat('7',64),'key','morning-2099-02-02','now','2099-02-02T00:45:01Z','readyAt','2099-02-02T00:50:00Z'));
  result := public.melinda_daily_pipeline('submit_report', jsonb_build_object('capabilityHash',repeat('4',64),'input',report || '{"reportDate":"2099-02-02","periodDate":"2099-02-01","issues":"Susulan 07.46"}','contentHash',repeat('8',64),'now','2099-02-02T00:46:00Z'));
  first_claim := public.melinda_daily_pipeline('claim', jsonb_build_object('runId',morning_id,'owner','worker-a','now','2099-02-02T00:50:00Z','leaseSeconds',180));
  result := public.melinda_daily_pipeline('publish', jsonb_build_object('runId',morning_id,'owner','worker-a','fencingToken',(first_claim->>'fencingToken')::bigint,'sourceGeneration',pinned_generation,'kind','management_brief','producerId','daily-pipeline','key','morning-2099-02-02','date','2099-02-02','payloadHash',repeat('7',64),'payload','{"dateIso":"2099-02-02","revision":1}','now','2099-02-02T00:50:00Z'));
  if result->>'errorCode' is not null or result->>'date' <> '2099-02-02' then raise exception 'Late report invalidated frozen morning publication: %', result; end if;

  -- A delayed lower-order run can never become latest after the noon revision.
  result := public.melinda_daily_pipeline('latest_reports', '{"reportDate":"2099-02-02"}');
  pinned_generation := (result->>'generation')::bigint;
  result := public.melinda_daily_pipeline('schedule', jsonb_build_object('reportDate','2099-02-02','phase','delayed_morning','publicationOrder',1,'semanticHash',repeat('9',64)));
  delayed_id := (result->>'runId')::uuid;
  first_claim := public.melinda_daily_pipeline('claim', jsonb_build_object('runId',delayed_id,'owner','worker-old','now','2099-02-02T01:00:00Z','leaseSeconds',180));
  result := public.melinda_daily_pipeline('prepare', jsonb_build_object('runId',delayed_id,'owner','worker-old','fencingToken',(first_claim->>'fencingToken')::bigint,'sourceGeneration',pinned_generation,'manifest','{}','payload','{"dateIso":"2099-02-02","revision":1}','payloadHash',repeat('a',64),'key','delayed-2099-02-02','now','2099-02-02T01:00:01Z'));
  result := public.melinda_daily_pipeline('schedule', jsonb_build_object('reportDate','2099-02-02','phase','revision_1200','publicationOrder',2,'semanticHash',repeat('b',64)));
  noon_id := (result->>'runId')::uuid;
  second_claim := public.melinda_daily_pipeline('claim', jsonb_build_object('runId',noon_id,'owner','worker-new','now','2099-02-02T05:00:00Z','leaseSeconds',180));
  result := public.melinda_daily_pipeline('prepare', jsonb_build_object('runId',noon_id,'owner','worker-new','fencingToken',(second_claim->>'fencingToken')::bigint,'sourceGeneration',pinned_generation,'manifest','{}','payload','{"dateIso":"2099-02-02","revision":2,"includes":"Susulan 07.46"}','payloadHash',repeat('c',64),'key','noon-2099-02-02','now','2099-02-02T05:00:01Z'));
  result := public.melinda_daily_pipeline('publish', jsonb_build_object('runId',noon_id,'owner','worker-new','fencingToken',(second_claim->>'fencingToken')::bigint,'sourceGeneration',pinned_generation,'kind','management_brief','producerId','daily-pipeline','key','noon-2099-02-02','date','2099-02-02','payloadHash',repeat('c',64),'payload','{"dateIso":"2099-02-02","revision":2,"includes":"Susulan 07.46"}','now','2099-02-02T05:00:02Z'));
  first_claim := public.melinda_daily_pipeline('claim', jsonb_build_object('runId',delayed_id,'owner','worker-old','now','2099-02-02T05:04:00Z','leaseSeconds',180));
  result := public.melinda_daily_pipeline('publish', jsonb_build_object('runId',delayed_id,'owner','worker-old','fencingToken',(first_claim->>'fencingToken')::bigint,'sourceGeneration',pinned_generation,'kind','management_brief','producerId','daily-pipeline','key','delayed-2099-02-02','date','2099-02-02','payloadHash',repeat('a',64),'payload','{"dateIso":"2099-02-02","revision":1}','now','2099-02-02T05:04:01Z'));
  if result->>'errorCode' <> 'superseded' then raise exception 'Older publication overwrote noon revision: %', result; end if;
end;
$$;
rollback;
