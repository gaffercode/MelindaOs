-- Agent gateway: internal agents (server-to-server, bearer token) submit knowledge drafts and
-- dashboard data records through /api/v1/agent/*. This migration adds two append-only intake
-- tables plus an audit trail, and the server-only RPC public.melinda_agent_gateway. Submissions
-- land as 'submitted' and still need human review before they become canonical knowledge; nothing
-- here approves, publishes, or mutates existing knowledge.
begin;

create table melinda_private.agent_knowledge_submissions (
  id uuid primary key default gen_random_uuid(),
  producer text not null check (length(producer) between 1 and 80),
  request_key text not null check (length(request_key) between 8 and 128),
  request_hash text not null check (length(request_hash) = 64),
  title text not null check (length(title) between 1 and 200),
  category text not null check (category in ('A','B','C')),
  doc_id text check (doc_id is null or length(doc_id) between 1 and 120),
  domain text check (domain is null or length(domain) between 1 and 80),
  department text check (department is null or length(department) between 1 and 120),
  content text not null check (length(content) between 1 and 200000),
  note text check (note is null or length(note) between 1 and 1000),
  source text check (source is null or length(source) between 1 and 300),
  status text not null default 'submitted' check (status in ('submitted','accepted','rejected')),
  received_at timestamptz not null default clock_timestamp(),
  unique (producer, request_key)
);
create index agent_knowledge_submissions_recent on melinda_private.agent_knowledge_submissions (received_at desc);

create table melinda_private.agent_data_records (
  id uuid primary key default gen_random_uuid(),
  producer text not null check (length(producer) between 1 and 80),
  request_key text not null check (length(request_key) between 8 and 128),
  request_hash text not null check (length(request_hash) = 64),
  kind text not null check (kind ~ '^[a-z][a-z0-9_.-]{0,47}$'),
  title text check (title is null or length(title) between 1 and 200),
  summary text check (summary is null or length(summary) between 1 and 1000),
  url text check (url is null or (length(url) between 1 and 2000 and url ~ '^https://')),
  occurred_at timestamptz,
  payload jsonb not null check (octet_length(payload::text) <= 40000),
  received_at timestamptz not null default clock_timestamp(),
  unique (producer, request_key)
);
create index agent_data_records_kind on melinda_private.agent_data_records (kind, received_at desc);

create table melinda_private.agent_audit (
  id bigint generated always as identity primary key,
  actor text not null check (length(actor) between 1 and 80),
  action text not null check (length(action) between 1 and 60),
  ref_id uuid,
  created_at timestamptz not null default clock_timestamp()
);

alter table melinda_private.agent_knowledge_submissions enable row level security;
alter table melinda_private.agent_data_records enable row level security;
alter table melinda_private.agent_audit enable row level security;
revoke all on melinda_private.agent_knowledge_submissions from public, anon, authenticated, service_role;
revoke all on melinda_private.agent_data_records from public, anon, authenticated, service_role;
revoke all on melinda_private.agent_audit from public, anon, authenticated, service_role;

create function public.melinda_agent_gateway(command text, args jsonb)
returns jsonb language plpgsql security definer set search_path = ''
set lock_timeout = '1s' set statement_timeout = '5s'
as $$
declare
  sub melinda_private.agent_knowledge_submissions%rowtype;
  rec melinda_private.agent_data_records%rowtype;
  result jsonb;
  replayed boolean := false;
begin
  if command = 'knowledge_submit' then
    perform pg_advisory_xact_lock(hashtextextended('agent_ks:' || (args->>'producer') || ':' || (args->>'key'), 0));
    select * into sub from melinda_private.agent_knowledge_submissions
      where producer = args->>'producer' and request_key = args->>'key';
    if found then
      if sub.request_hash <> args->>'requestHash' then return jsonb_build_object('errorCode', 'conflict'); end if;
      replayed := true;
    else
      insert into melinda_private.agent_knowledge_submissions
        (producer, request_key, request_hash, title, category, doc_id, domain, department, content, note, source)
      values
        (args->>'producer', args->>'key', args->>'requestHash', args->>'title', args->>'category',
         nullif(args->>'docId', ''), nullif(args->>'domain', ''), nullif(args->>'department', ''),
         args->>'content', nullif(args->>'note', ''), nullif(args->>'source', ''))
      returning * into sub;
      insert into melinda_private.agent_audit(actor, action, ref_id) values(args->>'producer', 'knowledge_submit', sub.id);
    end if;
    return jsonb_build_object('submission', jsonb_build_object(
      'id', sub.id, 'producer', sub.producer, 'title', sub.title, 'category', sub.category,
      'docId', sub.doc_id, 'domain', sub.domain, 'department', sub.department, 'content', sub.content,
      'note', sub.note, 'source', sub.source, 'status', sub.status, 'receivedAt', sub.received_at), 'replayed', replayed);

  elsif command = 'knowledge_list' then
    select jsonb_agg(jsonb_build_object(
      'id', s.id, 'producer', s.producer, 'title', s.title, 'category', s.category,
      'docId', s.doc_id, 'domain', s.domain, 'department', s.department,
      'status', s.status, 'receivedAt', s.received_at) order by s.received_at desc, s.id desc)
      into result
      from (select * from melinda_private.agent_knowledge_submissions
            where producer = args->>'producer'
            order by received_at desc, id desc limit 100) s;
    return jsonb_build_object('submissions', coalesce(result, '[]'::jsonb));

  elsif command = 'knowledge_read' then
    select * into sub from melinda_private.agent_knowledge_submissions
      where id = (args->>'id')::uuid and producer = args->>'producer';
    if not found then return jsonb_build_object('errorCode', 'not_found'); end if;
    return jsonb_build_object('submission', jsonb_build_object(
      'id', sub.id, 'producer', sub.producer, 'title', sub.title, 'category', sub.category,
      'docId', sub.doc_id, 'domain', sub.domain, 'department', sub.department, 'content', sub.content,
      'note', sub.note, 'source', sub.source, 'status', sub.status, 'receivedAt', sub.received_at));

  elsif command = 'data_submit' then
    perform pg_advisory_xact_lock(hashtextextended('agent_dr:' || (args->>'producer') || ':' || (args->>'key'), 0));
    select * into rec from melinda_private.agent_data_records
      where producer = args->>'producer' and request_key = args->>'key';
    if found then
      if rec.request_hash <> args->>'requestHash' then return jsonb_build_object('errorCode', 'conflict'); end if;
      replayed := true;
    else
      insert into melinda_private.agent_data_records
        (producer, request_key, request_hash, kind, title, summary, url, occurred_at, payload)
      values
        (args->>'producer', args->>'key', args->>'requestHash', args->>'kind',
         nullif(args->>'title', ''), nullif(args->>'summary', ''), nullif(args->>'url', ''),
         nullif(args->>'occurredAt', '')::timestamptz, args->'payload')
      returning * into rec;
      insert into melinda_private.agent_audit(actor, action, ref_id) values(args->>'producer', 'data_submit', rec.id);
    end if;
    return jsonb_build_object('record', jsonb_build_object(
      'id', rec.id, 'producer', rec.producer, 'kind', rec.kind, 'title', rec.title,
      'summary', rec.summary, 'url', rec.url, 'occurredAt', rec.occurred_at,
      'payload', rec.payload, 'receivedAt', rec.received_at), 'replayed', replayed);

  elsif command = 'data_list' then
    select jsonb_agg(jsonb_build_object(
      'id', d.id, 'producer', d.producer, 'kind', d.kind, 'title', d.title,
      'summary', d.summary, 'url', d.url, 'occurredAt', d.occurred_at,
      'payload', d.payload, 'receivedAt', d.received_at) order by d.received_at desc, d.id desc)
      into result
      from (select * from melinda_private.agent_data_records d
            where (args->>'kind' is null or d.kind = args->>'kind')
              and (args->>'producer' is null or d.producer = args->>'producer')
              and (args->>'since' is null or coalesce(d.occurred_at, d.received_at) >= (args->>'since')::timestamptz)
            order by d.received_at desc, d.id desc
            limit least(greatest(coalesce((args->>'limit')::integer, 100), 1), 200)) d;
    return jsonb_build_object('records', coalesce(result, '[]'::jsonb));

  else
    return jsonb_build_object('errorCode', 'invalid_command');
  end if;
end;
$$;

revoke all on function public.melinda_agent_gateway(text, jsonb) from public, anon, authenticated;
grant execute on function public.melinda_agent_gateway(text, jsonb) to service_role;
comment on function public.melinda_agent_gateway(text, jsonb) is 'Server-only agent gateway intake: knowledge submissions (human review required) and dashboard data records. Never expose the Supabase secret key to an agent.';

commit;
