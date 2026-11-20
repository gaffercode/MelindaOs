-- Persistent state for the scheduled daily dashboard pipeline.
-- Apply after 202610240001_daily_documents.sql. Private tables remain RPC-only.
begin;

create table melinda_private.daily_pipeline_runs (
  id uuid primary key default gen_random_uuid(),
  report_date date not null,
  phase text not null check (phase ~ '^[a-z][a-z0-9_-]{1,39}$'),
  publication_order smallint not null default 0 check (publication_order between 0 and 100),
  state text not null default 'scheduled' check (state in ('scheduled','running','retry_wait','published','no_change','failed')),
  semantic_hash text check (semantic_hash is null or length(semantic_hash) = 64),
  source_generation bigint not null default 0,
  registry jsonb,
  registry_hash text check (registry_hash is null or length(registry_hash) = 64),
  invitations jsonb not null default '{}'::jsonb,
  manifest jsonb,
  prepared_payload jsonb,
  prepared_payload_hash text check (prepared_payload_hash is null or length(prepared_payload_hash) = 64),
  prepared_key text,
  attempt smallint not null default 0 check (attempt between 0 and 3),
  next_attempt_at timestamptz,
  lease_owner text,
  lease_until timestamptz,
  fencing_token bigint not null default 0,
  receipt jsonb,
  error_code text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (report_date, phase)
);

create table melinda_private.daily_source_reports (
  id uuid primary key default gen_random_uuid(),
  generation bigint generated always as identity,
  source_id text not null check (source_id ~ '^[a-z][a-z0-9_-]{1,39}$'),
  report_date date not null,
  period_date date not null,
  observed_at timestamptz not null,
  received_at timestamptz not null default clock_timestamp(),
  availability text not null check (availability in ('received','no_issues','unavailable','invalid')),
  revision integer not null check (revision > 0),
  content_hash text not null check (length(content_hash) = 64),
  content jsonb not null,
  unique (source_id, report_date, content_hash),
  unique (source_id, report_date, revision)
);
create index daily_source_reports_latest on melinda_private.daily_source_reports (report_date, source_id, revision desc);

create table melinda_private.daily_alert_deliveries (
  id uuid primary key default gen_random_uuid(),
  report_date date not null,
  source_id text not null,
  condition text not null,
  episode_key text not null check (length(episode_key) = 64),
  relay_target text not null,
  state text not null default 'pending' check (state in ('pending','sending','sent','failed')),
  attempt smallint not null default 0 check (attempt between 0 and 3),
  next_attempt_at timestamptz,
  receipt jsonb,
  error_code text,
  lease_owner text,
  lease_until timestamptz,
  fencing_token bigint not null default 0,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (episode_key)
);
create index daily_alert_deliveries_due on melinda_private.daily_alert_deliveries (state, next_attempt_at);

alter table melinda_private.daily_pipeline_runs enable row level security;
alter table melinda_private.daily_source_reports enable row level security;
alter table melinda_private.daily_alert_deliveries enable row level security;
revoke all on melinda_private.daily_pipeline_runs, melinda_private.daily_source_reports, melinda_private.daily_alert_deliveries from public, anon, authenticated, service_role;
revoke all on sequence melinda_private.daily_source_reports_generation_seq from public, anon, authenticated, service_role;

alter table melinda_private.daily_documents
  add column pipeline_run_id uuid references melinda_private.daily_pipeline_runs(id),
  add column fencing_token bigint;
create unique index daily_documents_pipeline_run on melinda_private.daily_documents(pipeline_run_id) where pipeline_run_id is not null;

create function public.melinda_daily_pipeline(command text, args jsonb)
returns jsonb language plpgsql security definer set search_path = ''
set lock_timeout = '2s' set statement_timeout = '8s'
as $$
declare
  run melinda_private.daily_pipeline_runs%rowtype;
  report melinda_private.daily_source_reports%rowtype;
  alert melinda_private.daily_alert_deliveries%rowtype;
  document melinda_private.daily_documents%rowtype;
  run_id_value uuid;
  selected_date date;
  source_id_value text;
  source_value jsonb;
  invitation_value jsonb;
  capability_hash text := args->>'capabilityHash';
  now_value timestamptz := clock_timestamp();
  generation_value bigint;
  revision_value integer;
  receipt_value jsonb;
  replayed boolean := false;
begin
  if args ? 'now' then
    begin now_value := (args->>'now')::timestamptz; exception when others then return jsonb_build_object('errorCode','invalid_time'); end;
  end if;

  if command = 'snapshot_registry' then
    begin selected_date := (args->>'reportDate')::date; exception when others then return jsonb_build_object('errorCode','invalid_date'); end;
    if jsonb_typeof(args->'registry') <> 'object' or length(coalesce(args->>'registryHash','')) <> 64 then return jsonb_build_object('errorCode','invalid_registry'); end if;
    perform pg_advisory_xact_lock(hashtextextended('daily-registry:' || selected_date::text, 0));
    select * into run from melinda_private.daily_pipeline_runs where report_date = selected_date and phase = 'collect' for update;
    if found then
      if run.registry_hash <> args->>'registryHash' then return jsonb_build_object('errorCode','conflict'); end if;
      return jsonb_build_object('registryHash',run.registry_hash,'replayed',true,'runId',run.id);
    end if;
    insert into melinda_private.daily_pipeline_runs(report_date,phase,registry,registry_hash)
      values(selected_date,'collect',args->'registry',args->>'registryHash') returning * into run;
    return jsonb_build_object('registryHash',run.registry_hash,'replayed',false,'runId',run.id);

  elsif command = 'invite' then
    begin selected_date := (args->>'reportDate')::date; exception when others then return jsonb_build_object('errorCode','invalid_date'); end;
    if length(coalesce(capability_hash,'')) <> 64 then return jsonb_build_object('errorCode','invalid_capability'); end if;
    select * into run from melinda_private.daily_pipeline_runs where report_date = selected_date and phase = 'collect' for update;
    if not found then return jsonb_build_object('errorCode','registry_missing'); end if;
    select value into source_value from jsonb_array_elements(run.registry->'sources') where value->>'id' = args->>'sourceId';
    if source_value is null or source_value->>'kind' <> 'unit_report' then return jsonb_build_object('errorCode','invalid_source'); end if;
    invitation_value := jsonb_build_object('capabilityHash',capability_hash,'expiresAt',args->>'expiresAt','revoked',false);
    if run.invitations ? (args->>'sourceId') then
      if run.invitations->(args->>'sourceId')->>'capabilityHash' <> capability_hash then return jsonb_build_object('errorCode','conflict'); end if;
      return jsonb_build_object('runId',run.id,'sourceId',args->>'sourceId','reportDate',run.report_date,'replayed',true);
    end if;
    update melinda_private.daily_pipeline_runs set invitations = jsonb_set(invitations,array[args->>'sourceId'],invitation_value,true), updated_at = clock_timestamp() where id = run.id returning * into run;
    return jsonb_build_object('runId',run.id,'sourceId',args->>'sourceId','reportDate',run.report_date,'replayed',false);

  elsif command in ('exchange_capability','submit_report') then
    if length(coalesce(capability_hash,'')) <> 64 then return jsonb_build_object('errorCode','invalid_capability'); end if;
    select r.id, entry.key, entry.value into run_id_value, source_id_value, invitation_value
      from melinda_private.daily_pipeline_runs r cross join lateral jsonb_each(r.invitations) entry
      where r.phase = 'collect' and entry.value->>'capabilityHash' = capability_hash limit 1;
    if not found or coalesce((invitation_value->>'revoked')::boolean,true) or (invitation_value->>'expiresAt')::timestamptz <= now_value then
      return jsonb_build_object('errorCode','invalid_capability');
    end if;
    select * into run from melinda_private.daily_pipeline_runs where id=run_id_value;
    select value into invitation_value from jsonb_array_elements(run.registry->'sources') where value->>'id' = source_id_value;
    if command = 'exchange_capability' then
      return jsonb_build_object('sourceId',source_id_value,'reportDate',run.report_date,'expiresAt',(run.invitations->source_id_value)->>'expiresAt','source',invitation_value);
    end if;
    if args->'input'->>'sourceId' <> source_id_value or args->'input'->>'reportDate' <> run.report_date::text then return jsonb_build_object('errorCode','invalid_scope'); end if;
    if length(coalesce(args->>'contentHash','')) <> 64 then return jsonb_build_object('errorCode','invalid_payload'); end if;
    perform pg_advisory_xact_lock(hashtextextended('daily-report:' || run.report_date::text || ':' || source_id_value,0));
    select * into report from melinda_private.daily_source_reports where source_id = source_id_value and report_date = run.report_date and content_hash = args->>'contentHash';
    if found then return jsonb_build_object('replayed',true,'revision',report.revision,'receipt',report.id); end if;
    select coalesce(max(revision),0)+1 into revision_value from melinda_private.daily_source_reports where source_id = source_id_value and report_date = run.report_date;
    begin
      insert into melinda_private.daily_source_reports(source_id,report_date,period_date,observed_at,received_at,availability,revision,content_hash,content)
        values(source_id_value,run.report_date,(args->'input'->>'periodDate')::date,(args->'input'->>'observedAt')::timestamptz,now_value,args->'input'->>'availability',revision_value,args->>'contentHash',args->'input') returning * into report;
    exception when others then return jsonb_build_object('errorCode','invalid_payload'); end;
    return jsonb_build_object('replayed',false,'revision',report.revision,'receipt',report.id);

  elsif command = 'revoke_capability' then
    begin selected_date := (args->>'reportDate')::date; exception when others then return jsonb_build_object('errorCode','invalid_date'); end;
    update melinda_private.daily_pipeline_runs set invitations = jsonb_set(invitations,array[args->>'sourceId','revoked'],'true'::jsonb,false), updated_at=clock_timestamp()
      where report_date=selected_date and phase='collect' and invitations ? (args->>'sourceId') returning * into run;
    return jsonb_build_object('revoked',found);

  elsif command = 'latest_reports' then
    begin selected_date := (args->>'reportDate')::date; exception when others then return jsonb_build_object('errorCode','invalid_date'); end;
    select coalesce(max(generation),0) into generation_value from melinda_private.daily_source_reports where report_date=selected_date and (not (args ? 'cutoffAt') or received_at <= (args->>'cutoffAt')::timestamptz);
    return jsonb_build_object('generation',generation_value,'reports',coalesce((
      select jsonb_agg(content || jsonb_build_object('receivedAt',received_at,'contentHash',content_hash,'revision',revision) order by source_id)
      from (select distinct on (source_id) * from melinda_private.daily_source_reports where report_date=selected_date and (not (args ? 'cutoffAt') or received_at <= (args->>'cutoffAt')::timestamptz) order by source_id,revision desc) latest
    ),'[]'::jsonb));

  elsif command = 'read_registry' then
    begin selected_date := (args->>'reportDate')::date; exception when others then return jsonb_build_object('errorCode','invalid_date'); end;
    select * into run from melinda_private.daily_pipeline_runs where report_date=selected_date and phase='collect';
    if not found then return jsonb_build_object('errorCode','not_found'); end if;
    return jsonb_build_object('registry',run.registry,'registryHash',run.registry_hash);

  elsif command = 'ingest_source' then
    begin selected_date := (args->'input'->>'reportDate')::date; exception when others then return jsonb_build_object('errorCode','invalid_date'); end;
    source_id_value := args->'input'->>'sourceId';
    if length(coalesce(args->>'contentHash','')) <> 64 or source_id_value !~ '^[a-z][a-z0-9_-]{1,39}$' then return jsonb_build_object('errorCode','invalid_payload'); end if;
    select * into run from melinda_private.daily_pipeline_runs where report_date=selected_date and phase='collect';
    if not found or not exists (select 1 from jsonb_array_elements(run.registry->'sources') where value->>'id'=source_id_value) then return jsonb_build_object('errorCode','invalid_source'); end if;
    perform pg_advisory_xact_lock(hashtextextended('daily-report:' || selected_date::text || ':' || source_id_value,0));
    select * into report from melinda_private.daily_source_reports where source_id=source_id_value and report_date=selected_date and content_hash=args->>'contentHash';
    if found then return jsonb_build_object('replayed',true,'revision',report.revision,'receipt',report.id,'generation',report.generation); end if;
    select coalesce(max(revision),0)+1 into revision_value from melinda_private.daily_source_reports where source_id=source_id_value and report_date=selected_date;
    begin
      insert into melinda_private.daily_source_reports(source_id,report_date,period_date,observed_at,received_at,availability,revision,content_hash,content)
        values(source_id_value,selected_date,(args->'input'->>'periodDate')::date,(args->'input'->>'observedAt')::timestamptz,now_value,args->'input'->>'availability',revision_value,args->>'contentHash',args->'input') returning * into report;
    exception when others then return jsonb_build_object('errorCode','invalid_payload'); end;
    return jsonb_build_object('replayed',false,'revision',report.revision,'receipt',report.id,'generation',report.generation);

  elsif command = 'schedule' then
    begin selected_date := (args->>'reportDate')::date; exception when others then return jsonb_build_object('errorCode','invalid_date'); end;
    begin
      insert into melinda_private.daily_pipeline_runs(report_date,phase,publication_order,semantic_hash) values(selected_date,args->>'phase',coalesce((args->>'publicationOrder')::smallint,0),args->>'semanticHash') returning * into run;
    exception when unique_violation then
      select * into run from melinda_private.daily_pipeline_runs where report_date=selected_date and phase=args->>'phase'; replayed := true;
      if run.semantic_hash is distinct from args->>'semanticHash' or run.publication_order <> coalesce((args->>'publicationOrder')::smallint,0) then return jsonb_build_object('errorCode','conflict'); end if;
    end;
    return jsonb_build_object('runId',run.id,'replayed',replayed,'state',run.state);

  elsif command = 'claim' then
    select * into run from melinda_private.daily_pipeline_runs where id=(args->>'runId')::uuid for update;
    if not found then return jsonb_build_object('errorCode','not_found'); end if;
    if run.state in ('published','no_change','failed') or (run.state='running' and run.lease_until > now_value) or (run.next_attempt_at is not null and run.next_attempt_at > now_value) then
      return jsonb_build_object('claimed',false,'state',run.state);
    end if;
    update melinda_private.daily_pipeline_runs set state='running',lease_owner=args->>'owner',lease_until=now_value + make_interval(secs=>least(greatest(coalesce((args->>'leaseSeconds')::integer,180),30),300)),fencing_token=fencing_token+1,updated_at=clock_timestamp()
      where id=run.id returning * into run;
    return jsonb_build_object('claimed',true,'runId',run.id,'state',run.state,'fencingToken',run.fencing_token,'leaseUntil',run.lease_until);

  elsif command = 'prepare' then
    select * into run from melinda_private.daily_pipeline_runs where id=(args->>'runId')::uuid for update;
    if not found then return jsonb_build_object('errorCode','not_found'); end if;
    if run.state <> 'running' or run.lease_owner <> args->>'owner' or run.fencing_token <> (args->>'fencingToken')::bigint or run.lease_until <= now_value then return jsonb_build_object('errorCode','stale_lease'); end if;
    select coalesce(max(generation),0) into generation_value from melinda_private.daily_source_reports where report_date=run.report_date;
    if generation_value < (args->>'sourceGeneration')::bigint then return jsonb_build_object('errorCode','source_changed'); end if;
    if run.prepared_payload_hash is not null and (run.prepared_payload_hash <> args->>'payloadHash' or run.prepared_key <> args->>'key') then return jsonb_build_object('errorCode','conflict'); end if;
    update melinda_private.daily_pipeline_runs set source_generation=(args->>'sourceGeneration')::bigint,manifest=args->'manifest',prepared_payload=args->'payload',prepared_payload_hash=args->>'payloadHash',prepared_key=args->>'key',
      state=case when args ? 'readyAt' and (args->>'readyAt')::timestamptz > now_value then 'scheduled' else state end,
      next_attempt_at=case when args ? 'readyAt' and (args->>'readyAt')::timestamptz > now_value then (args->>'readyAt')::timestamptz else next_attempt_at end,
      lease_owner=case when args ? 'readyAt' and (args->>'readyAt')::timestamptz > now_value then null else lease_owner end,
      lease_until=case when args ? 'readyAt' and (args->>'readyAt')::timestamptz > now_value then null else lease_until end,
      updated_at=clock_timestamp() where id=run.id returning * into run;
    return jsonb_build_object('prepared',true,'runId',run.id,'payloadHash',run.prepared_payload_hash);

  elsif command = 'publish' then
    select * into run from melinda_private.daily_pipeline_runs where id=(args->>'runId')::uuid for update;
    if not found then return jsonb_build_object('errorCode','not_found'); end if;
    if run.state='published' and run.receipt is not null then return run.receipt || jsonb_build_object('replayed',true); end if;
    if run.state <> 'running' or run.lease_owner <> args->>'owner' or run.fencing_token <> (args->>'fencingToken')::bigint or run.lease_until <= now_value then return jsonb_build_object('errorCode','stale_lease'); end if;
    if run.prepared_payload_hash <> args->>'payloadHash' or run.prepared_key <> args->>'key' or run.prepared_payload <> args->'payload' then return jsonb_build_object('errorCode','payload_changed'); end if;
    if (args->>'sourceGeneration')::bigint <> run.source_generation then return jsonb_build_object('errorCode','source_changed'); end if;
    perform pg_advisory_xact_lock(hashtextextended('daily-publish:' || run.report_date::text,0));
    if exists (
      select 1 from melinda_private.daily_documents d join melinda_private.daily_pipeline_runs newer on newer.id=d.pipeline_run_id
      where d.kind=args->>'kind' and d.report_date=run.report_date and newer.publication_order > run.publication_order
    ) then return jsonb_build_object('errorCode','superseded'); end if;
    select * into document from melinda_private.daily_documents where kind=args->>'kind' and producer=args->>'producerId' and request_key=args->>'key';
    if found then
      if document.payload_hash <> args->>'payloadHash' or document.pipeline_run_id <> run.id then return jsonb_build_object('errorCode','conflict'); end if;
      replayed := true;
    else
      insert into melinda_private.daily_documents(kind,report_date,producer,request_key,payload_hash,payload,pipeline_run_id,fencing_token,received_at)
        values(args->>'kind',run.report_date,args->>'producerId',args->>'key',args->>'payloadHash',args->'payload',run.id,run.fencing_token,now_value) returning * into document;
    end if;
    receipt_value := jsonb_build_object('replayed',replayed,'id',document.id,'kind',document.kind,'date',document.report_date,'payloadHash',document.payload_hash,'receivedAt',document.received_at,'runId',run.id);
    update melinda_private.daily_pipeline_runs set state='published',receipt=receipt_value,lease_owner=null,lease_until=null,updated_at=clock_timestamp() where id=run.id;
    return receipt_value;

  elsif command = 'retry' then
    select * into run from melinda_private.daily_pipeline_runs where id=(args->>'runId')::uuid for update;
    if not found then return jsonb_build_object('errorCode','not_found'); end if;
    if run.state <> 'running' or run.lease_owner <> args->>'owner' or run.fencing_token <> (args->>'fencingToken')::bigint then return jsonb_build_object('errorCode','stale_lease'); end if;
    if run.attempt + 1 >= 3 or coalesce((args->>'terminal')::boolean,false) then
      update melinda_private.daily_pipeline_runs set state='failed',attempt=attempt+1,error_code=args->>'errorCode',lease_owner=null,lease_until=null,updated_at=clock_timestamp() where id=run.id returning * into run;
    else
      update melinda_private.daily_pipeline_runs set state='retry_wait',attempt=attempt+1,next_attempt_at=(args->>'nextAttemptAt')::timestamptz,error_code=args->>'errorCode',lease_owner=null,lease_until=null,updated_at=clock_timestamp() where id=run.id returning * into run;
    end if;
    return jsonb_build_object('runId',run.id,'state',run.state,'attempt',run.attempt,'nextAttemptAt',run.next_attempt_at);

  elsif command = 'read_run' then
    begin selected_date := (args->>'reportDate')::date; exception when others then return jsonb_build_object('errorCode','invalid_date'); end;
    select * into run from melinda_private.daily_pipeline_runs where report_date=selected_date and phase=args->>'phase';
    if not found then return jsonb_build_object('errorCode','not_found'); end if;
    return jsonb_build_object('run',jsonb_build_object('id',run.id,'reportDate',run.report_date,'phase',run.phase,'publicationOrder',run.publication_order,'state',run.state,'sourceGeneration',run.source_generation,'semanticHash',run.semantic_hash,'preparedPayload',run.prepared_payload,'preparedPayloadHash',run.prepared_payload_hash,'preparedKey',run.prepared_key,'attempt',run.attempt,'nextAttemptAt',run.next_attempt_at,'receipt',run.receipt,'errorCode',run.error_code));

  elsif command = 'no_change' then
    select * into run from melinda_private.daily_pipeline_runs where id=(args->>'runId')::uuid for update;
    if not found or run.state <> 'running' or run.lease_owner <> args->>'owner' or run.fencing_token <> (args->>'fencingToken')::bigint then return jsonb_build_object('errorCode','stale_lease'); end if;
    update melinda_private.daily_pipeline_runs set state='no_change',receipt=jsonb_build_object('semanticHash',run.semantic_hash),lease_owner=null,lease_until=null,updated_at=clock_timestamp() where id=run.id;
    return jsonb_build_object('runId',run.id,'state','no_change');

  elsif command = 'create_alert' then
    begin selected_date := (args->>'reportDate')::date; exception when others then return jsonb_build_object('errorCode','invalid_date'); end;
    if args->>'sourceId' !~ '^[a-z][a-z0-9_-]{1,39}$' or args->>'condition' not in ('missing','invalid','unavailable','invitation') or length(coalesce(args->>'episodeKey','')) <> 64 or length(coalesce(args->>'relayTarget','')) not between 1 and 120 then return jsonb_build_object('errorCode','invalid_alert'); end if;
    begin
      insert into melinda_private.daily_alert_deliveries(report_date,source_id,condition,episode_key,relay_target)
        values(selected_date,args->>'sourceId',args->>'condition',args->>'episodeKey',args->>'relayTarget') returning * into alert;
    exception when unique_violation then select * into alert from melinda_private.daily_alert_deliveries where episode_key=args->>'episodeKey'; replayed:=true; end;
    if alert.report_date <> selected_date or alert.source_id <> args->>'sourceId' or alert.condition <> args->>'condition' or alert.relay_target <> args->>'relayTarget' then return jsonb_build_object('errorCode','conflict'); end if;
    return jsonb_build_object('alertId',alert.id,'state',alert.state,'replayed',replayed);

  elsif command = 'claim_alert' then
    select * into alert from melinda_private.daily_alert_deliveries where id=(args->>'alertId')::uuid for update;
    if not found then return jsonb_build_object('errorCode','not_found'); end if;
    if alert.state='sent' or alert.attempt >= 3 or (alert.state='sending' and alert.lease_until > now_value) or (alert.next_attempt_at is not null and alert.next_attempt_at > now_value) then return jsonb_build_object('claimed',false,'state',alert.state); end if;
    update melinda_private.daily_alert_deliveries set state='sending',lease_owner=args->>'owner',lease_until=now_value+interval '180 seconds',fencing_token=fencing_token+1,updated_at=clock_timestamp() where id=alert.id returning * into alert;
    return jsonb_build_object('claimed',true,'alertId',alert.id,'fencingToken',alert.fencing_token,'relayTarget',alert.relay_target,'condition',alert.condition);

  elsif command = 'finish_alert' then
    select * into alert from melinda_private.daily_alert_deliveries where id=(args->>'alertId')::uuid for update;
    if not found or alert.state<>'sending' or alert.lease_owner<>args->>'owner' or alert.fencing_token<>(args->>'fencingToken')::bigint then return jsonb_build_object('errorCode','stale_lease'); end if;
    update melinda_private.daily_alert_deliveries set state=case when (args->>'acknowledged')::boolean then 'sent' else 'failed' end,attempt=attempt+1,receipt=args->'receipt',error_code=args->>'errorCode',next_attempt_at=case when (args->>'acknowledged')::boolean then null else (args->>'nextAttemptAt')::timestamptz end,lease_owner=null,lease_until=null,updated_at=clock_timestamp() where id=alert.id returning * into alert;
    return jsonb_build_object('alertId',alert.id,'state',alert.state,'attempt',alert.attempt);

  elsif command = 'version' then
    begin selected_date := (args->>'reportDate')::date; exception when others then return jsonb_build_object('errorCode','invalid_date'); end;
    select * into run from melinda_private.daily_pipeline_runs where report_date=selected_date and phase='collect';
    select coalesce(max(generation),0) into generation_value from melinda_private.daily_source_reports where report_date=selected_date;
    select * into document from melinda_private.daily_documents where kind='management_brief' and report_date=selected_date order by received_at desc,id desc limit 1;
    return jsonb_build_object('reportDate',selected_date,'serverDateWib',(now_value at time zone 'Asia/Jakarta')::date,'briefId',document.id,'briefReceivedAt',document.received_at,'sourceGeneration',generation_value,'registryHash',run.registry_hash,'alertFailures',(select count(*) from melinda_private.daily_alert_deliveries where report_date=selected_date and state='failed'));
  end if;
  return jsonb_build_object('errorCode','invalid_command');
end;
$$;

revoke all on function public.melinda_daily_pipeline(text,jsonb) from public, anon, authenticated;
grant execute on function public.melinda_daily_pipeline(text,jsonb) to service_role;
comment on function public.melinda_daily_pipeline(text,jsonb) is 'Server-only fenced state machine for daily source reports, publications, and per-unit alerts.';
commit;
