-- Agent draft review: the Director accepts or rejects knowledge drafts that agents submitted through
-- public.melinda_agent_gateway. Adds reviewed_by / reviewed_at / review_note to
-- melinda_private.agent_knowledge_submissions, one constraint that ties the three columns to the status,
-- and three server-only commands (review_list, review_read, review_decide). Accepting a draft only marks
-- it accepted; nothing here publishes it or touches existing knowledge. knowledge_submit, knowledge_list
-- and knowledge_read also return reviewedAt and reviewNote, so a producer sees the outcome.
-- The function body carries forward doc_file_index from 202611110002_agent_gateway_doc_file_index unchanged;
-- apply that migration first. Apply in the Supabase SQL Editor; the agent has no DB access.
begin;

select melinda_private.record_migration('202611110003', '202611110003_agent_draft_review');

alter table melinda_private.agent_knowledge_submissions
  add column reviewed_by text check (reviewed_by is null or length(reviewed_by) between 1 and 80),
  add column reviewed_at timestamptz,
  add column review_note text check (review_note is null or length(review_note) between 1 and 1000);

alter table melinda_private.agent_knowledge_submissions
  add constraint agent_knowledge_submissions_review_check check (
    (status = 'submitted' and reviewed_by is null and reviewed_at is null and review_note is null)
    or (status = 'accepted' and reviewed_by is not null and reviewed_at is not null)
    or (status = 'rejected' and reviewed_by is not null and reviewed_at is not null and review_note is not null)
  );

create or replace function public.melinda_agent_gateway(command text, args jsonb)
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
      'note', sub.note, 'source', sub.source, 'status', sub.status, 'receivedAt', sub.received_at,
      'reviewedAt', sub.reviewed_at, 'reviewNote', sub.review_note), 'replayed', replayed);

  elsif command = 'knowledge_list' then
    select jsonb_agg(jsonb_build_object(
      'id', s.id, 'producer', s.producer, 'title', s.title, 'category', s.category,
      'docId', s.doc_id, 'domain', s.domain, 'department', s.department,
      'status', s.status, 'receivedAt', s.received_at,
      'reviewedAt', s.reviewed_at, 'reviewNote', s.review_note) order by s.received_at desc, s.id desc)
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
      'note', sub.note, 'source', sub.source, 'status', sub.status, 'receivedAt', sub.received_at,
      'reviewedAt', sub.reviewed_at, 'reviewNote', sub.review_note));

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

  elsif command = 'doc_file_index' then
    -- Metadata-only listing of stored document files: number and sha256 per
    -- doc.file row, never the contentBase64 body. doc_status resolves
    -- fileStored from this index so a bulk file-payload read failure can no
    -- longer surface as "document not found".
    select jsonb_agg(jsonb_build_object(
      'id', d.id, 'producer', d.producer, 'kind', d.kind,
      'number', d.payload->>'number', 'sha256', d.payload->>'sha256',
      'receivedAt', d.received_at) order by d.received_at desc, d.id desc)
      into result
      from (select * from melinda_private.agent_data_records d
            where d.kind = 'doc.file'
              and (args->>'producer' is null or d.producer = args->>'producer')
              and (args->>'since' is null or d.received_at >= (args->>'since')::timestamptz)
            order by d.received_at desc, d.id desc
            limit least(greatest(coalesce((args->>'limit')::integer, 100), 1), 200)) d;
    return jsonb_build_object('records', coalesce(result, '[]'::jsonb));

  elsif command = 'review_list' then
    select jsonb_agg(jsonb_build_object(
      'id', s.id, 'producer', s.producer, 'title', s.title, 'category', s.category,
      'docId', s.doc_id, 'domain', s.domain, 'department', s.department,
      'note', s.note, 'source', s.source, 'status', s.status, 'receivedAt', s.received_at,
      'reviewedAt', s.reviewed_at, 'reviewNote', s.review_note) order by s.received_at desc, s.id desc)
      into result
      from (select * from melinda_private.agent_knowledge_submissions
            where status = args->>'status'
            order by received_at desc, id desc limit 100) s;
    return jsonb_build_object('submissions', coalesce(result, '[]'::jsonb));

  elsif command = 'review_read' then
    select * into sub from melinda_private.agent_knowledge_submissions
      where id = (args->>'id')::uuid;
    if not found then return jsonb_build_object('errorCode', 'not_found'); end if;
    return jsonb_build_object('submission', jsonb_build_object(
      'id', sub.id, 'producer', sub.producer, 'title', sub.title, 'category', sub.category,
      'docId', sub.doc_id, 'domain', sub.domain, 'department', sub.department, 'content', sub.content,
      'note', sub.note, 'source', sub.source, 'status', sub.status, 'receivedAt', sub.received_at,
      'reviewedAt', sub.reviewed_at, 'reviewNote', sub.review_note));

  elsif command = 'review_decide' then
    perform pg_advisory_xact_lock(hashtextextended('agent_ks_review:' || (args->>'id'), 0));
    select * into sub from melinda_private.agent_knowledge_submissions
      where id = (args->>'id')::uuid for update;
    if not found then return jsonb_build_object('errorCode', 'not_found'); end if;
    if coalesce(args->>'decision', '') not in ('accepted', 'rejected')
       or (coalesce(args->>'decision', '') = 'rejected' and nullif(btrim(coalesce(args->>'note', '')), '') is null)
       or nullif(args->>'reviewer', '') is null then
      return jsonb_build_object('errorCode', 'invalid_command');
    end if;
    if sub.status = args->>'decision' then
      replayed := true;
    elsif sub.status <> 'submitted' then
      return jsonb_build_object('errorCode', 'conflict');
    else
      update melinda_private.agent_knowledge_submissions
        set status = args->>'decision', reviewed_by = args->>'reviewer', reviewed_at = clock_timestamp(),
            review_note = nullif(btrim(coalesce(args->>'note', '')), '')
        where id = sub.id returning * into sub;
      insert into melinda_private.agent_audit(actor, action, ref_id)
        values (args->>'reviewer', 'review_' || sub.status, sub.id);
    end if;
    return jsonb_build_object('submission', jsonb_build_object(
      'id', sub.id, 'producer', sub.producer, 'title', sub.title, 'category', sub.category,
      'docId', sub.doc_id, 'domain', sub.domain, 'department', sub.department, 'content', sub.content,
      'note', sub.note, 'source', sub.source, 'status', sub.status, 'receivedAt', sub.received_at,
      'reviewedAt', sub.reviewed_at, 'reviewNote', sub.review_note), 'replayed', replayed);

  else
    return jsonb_build_object('errorCode', 'invalid_command');
  end if;
end;
$$;

revoke all on function public.melinda_agent_gateway(text, jsonb) from public, anon, authenticated;
grant execute on function public.melinda_agent_gateway(text, jsonb) to service_role;

commit;
