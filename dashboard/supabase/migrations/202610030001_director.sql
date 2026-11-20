begin;

create schema if not exists melinda_private;
revoke all on schema melinda_private from public, anon, authenticated;

create table melinda_private.revisions (
  id uuid primary key default gen_random_uuid(), report_date date not null,
  producer text not null, payload_hash text not null check (length(payload_hash) = 64),
  payload jsonb not null, status text not null default 'pending' check (status in ('pending','published','rejected','superseded')),
  received_at timestamptz not null default clock_timestamp(),
  unique (producer, report_date, payload_hash)
);
create table melinda_private.submissions (
  id uuid primary key default gen_random_uuid(), producer text not null, request_key text not null,
  payload_hash text not null, revision_id uuid not null references melinda_private.revisions,
  received_at timestamptz not null default clock_timestamp(), unique (producer, request_key)
);
create table melinda_private.publications (
  report_date date primary key, revision_id uuid not null references melinda_private.revisions
);
create table melinda_private.reviews (
  reviewer text not null, request_key text not null, request_hash text not null,
  receipt jsonb not null, primary key (reviewer, request_key)
);
create table melinda_private.audit (
  id bigint generated always as identity primary key, actor text not null, action text not null,
  revision_id uuid not null references melinda_private.revisions, created_at timestamptz not null default clock_timestamp()
);
create table melinda_private.sessions (
  token_hash text primary key, reviewer text not null, credential_version text not null,
  expires_at timestamptz not null default (clock_timestamp() + interval '30 minutes')
);
create table melinda_private.rate_limits (
  bucket text primary key, window_start timestamptz not null, attempts integer not null
);

alter table melinda_private.revisions enable row level security;
alter table melinda_private.submissions enable row level security;
alter table melinda_private.publications enable row level security;
alter table melinda_private.reviews enable row level security;
alter table melinda_private.audit enable row level security;
alter table melinda_private.sessions enable row level security;
alter table melinda_private.rate_limits enable row level security;
revoke all on all tables in schema melinda_private from public, anon, authenticated, service_role;
revoke all on all sequences in schema melinda_private from public, anon, authenticated, service_role;

create function public.melinda_director(command text, args jsonb)
returns jsonb language plpgsql security definer set search_path = ''
set lock_timeout = '1s' set statement_timeout = '5s'
as $$
declare
  revision melinda_private.revisions%rowtype;
  submission melinda_private.submissions%rowtype;
  previous melinda_private.reviews%rowtype;
  current_revision uuid;
  result jsonb;
  selected_date date;
  count_attempts integer;
begin
  if command = 'rate_limit' then
    delete from melinda_private.rate_limits where window_start < clock_timestamp() - interval '1 day';
    insert into melinda_private.rate_limits(bucket, window_start, attempts)
      values(args->>'bucket', clock_timestamp(), 1)
      on conflict (bucket) do update set
        attempts = case when melinda_private.rate_limits.window_start < clock_timestamp() - make_interval(secs => (args->>'seconds')::integer) then 1 else melinda_private.rate_limits.attempts + 1 end,
        window_start = case when melinda_private.rate_limits.window_start < clock_timestamp() - make_interval(secs => (args->>'seconds')::integer) then clock_timestamp() else melinda_private.rate_limits.window_start end
      returning attempts into count_attempts;
    return jsonb_build_object('allowed', count_attempts <= (args->>'limit')::integer);
  elsif command = 'rate_reset' then
    delete from melinda_private.rate_limits where bucket = args->>'bucket';
    return jsonb_build_object('ok', true);
  elsif command = 'session_create' then
    delete from melinda_private.sessions where expires_at <= clock_timestamp();
    insert into melinda_private.sessions(token_hash, reviewer, credential_version)
      values(args->>'tokenHash', args->>'reviewerId', args->>'credentialVersion');
    return jsonb_build_object('ok', true);
  elsif command = 'session_read' then
    select jsonb_build_object('reviewerId', reviewer) into result from melinda_private.sessions
      where token_hash = args->>'tokenHash' and credential_version = args->>'credentialVersion' and expires_at > clock_timestamp();
    return jsonb_build_object('session', result);
  elsif command = 'session_revoke' then
    delete from melinda_private.sessions where token_hash = args->>'tokenHash';
    return jsonb_build_object('ok', true);
  elsif command = 'submit' then
    if octet_length((args->'payload')::text) > 320000 or octet_length((args->'payload'->'brief')::text) > 256000 then
      return jsonb_build_object('errorCode', 'invalid_payload');
    end if;
    perform pg_advisory_xact_lock(hashtextextended('submit:' || (args->>'producerId') || ':' || (args->>'key'), 0));
    select * into submission from melinda_private.submissions where producer = args->>'producerId' and request_key = args->>'key';
    if found then
      if submission.payload_hash <> args->>'payloadHash' then return jsonb_build_object('errorCode', 'conflict'); end if;
      select * into revision from melinda_private.revisions where id = submission.revision_id;
      result = jsonb_build_object('replayed', true);
    else
      selected_date = (args->'payload'->'brief'->>'date')::date;
      insert into melinda_private.revisions(producer, report_date, payload_hash, payload)
        values(args->>'producerId', selected_date, args->>'payloadHash', args->'payload')
        on conflict (producer, report_date, payload_hash) do nothing;
      select * into revision from melinda_private.revisions
        where producer = args->>'producerId' and report_date = selected_date and payload_hash = args->>'payloadHash';
      insert into melinda_private.submissions(producer, request_key, payload_hash, revision_id)
        values(args->>'producerId', args->>'key', args->>'payloadHash', revision.id) returning * into submission;
      insert into melinda_private.audit(actor, action, revision_id) values(args->>'producerId', 'submitted', revision.id);
      result = jsonb_build_object('replayed', false);
    end if;
    return result || jsonb_build_object('submissionId', submission.id, 'revisionId', revision.id, 'payloadHash', revision.payload_hash,
      'date', revision.report_date, 'status', revision.status, 'receivedAt', submission.received_at);
  elsif command = 'submission_read' then
    select * into submission from melinda_private.submissions where id = (args->>'id')::uuid and producer = args->>'producerId';
    if not found then return jsonb_build_object('errorCode', 'not_found'); end if;
    select * into revision from melinda_private.revisions where id = submission.revision_id;
    return jsonb_build_object('submissionId', submission.id, 'revisionId', revision.id, 'payloadHash', revision.payload_hash,
      'date', revision.report_date, 'status', revision.status, 'receivedAt', submission.received_at);
  elsif command = 'published' then
    select to_jsonb(r) into result from melinda_private.publications p join melinda_private.revisions r on r.id = p.revision_id
      where p.report_date = (args->>'date')::date and r.status = 'published';
    return jsonb_build_object('published', result);
  elsif command = 'review_list' then
    select jsonb_agg(to_jsonb(r) order by r.received_at desc, r.id desc) into result from
      (select * from melinda_private.revisions where report_date = (args->>'date')::date and status = 'pending'
        order by received_at desc, id desc limit 50 offset (args->>'offset')::integer) r;
    select revision_id into current_revision from melinda_private.publications where report_date = (args->>'date')::date;
    return jsonb_build_object('pending', coalesce(result, '[]'::jsonb), 'publishedRevisionId', current_revision,
      'published', (select payload from melinda_private.revisions where id = current_revision));
  elsif command = 'revision_read' then
    select to_jsonb(r) into result from melinda_private.revisions r where id = (args->>'id')::uuid;
    if result is null then return jsonb_build_object('errorCode', 'not_found'); end if;
    return jsonb_build_object('revision', result);
  elsif command = 'review' then
    perform pg_advisory_xact_lock(hashtextextended('review:' || (args->>'reviewerId') || ':' || (args->>'key'), 0));
    select * into previous from melinda_private.reviews where reviewer = args->>'reviewerId' and request_key = args->>'key';
    if found then
      if previous.request_hash <> args->>'requestHash' then return jsonb_build_object('errorCode', 'conflict'); end if;
      return previous.receipt;
    end if;
    select * into revision from melinda_private.revisions where id = (args->>'id')::uuid;
    if not found then return jsonb_build_object('errorCode', 'not_found'); end if;
    perform pg_advisory_xact_lock(hashtextextended('publication:' || revision.report_date::text, 0));
    select * into revision from melinda_private.revisions where id = (args->>'id')::uuid for update;
    select revision_id into current_revision from melinda_private.publications where report_date = revision.report_date;
    if revision.status <> 'pending' or revision.payload_hash <> args->>'payloadHash'
      or current_revision is distinct from (args->>'expectedPublishedRevisionId')::uuid then
      return jsonb_build_object('errorCode', 'conflict');
    end if;
    if args->>'action' = 'approve-and-publish' then
      update melinda_private.revisions set status = 'superseded' where id = current_revision;
      update melinda_private.revisions set status = 'published' where id = revision.id;
      insert into melinda_private.publications(report_date, revision_id) values(revision.report_date, revision.id)
        on conflict (report_date) do update set revision_id = excluded.revision_id;
      result = jsonb_build_object('revisionId', revision.id, 'date', revision.report_date, 'status', 'published');
    elsif args->>'action' = 'reject' and length(trim(args->>'reason')) between 1 and 500 then
      update melinda_private.revisions set status = 'rejected' where id = revision.id;
      result = jsonb_build_object('revisionId', revision.id, 'date', revision.report_date, 'status', 'rejected', 'reason', args->>'reason');
    else return jsonb_build_object('errorCode', 'invalid_review');
    end if;
    result = result || jsonb_build_object('reviewedAt', clock_timestamp(), 'reviewerId', args->>'reviewerId');
    insert into melinda_private.audit(actor, action, revision_id) values(args->>'reviewerId', result->>'status', revision.id);
    insert into melinda_private.reviews(reviewer, request_key, request_hash, receipt) values(args->>'reviewerId', args->>'key', args->>'requestHash', result);
    return result;
  end if;
  return jsonb_build_object('errorCode', 'invalid_command');
end;
$$;

revoke all on function public.melinda_director(text, jsonb) from public, anon, authenticated;
grant execute on function public.melinda_director(text, jsonb) to service_role;
comment on function public.melinda_director(text, jsonb) is 'Server-only executive brief transactions. Never expose the Supabase secret key to a browser or Bot.';
commit;
