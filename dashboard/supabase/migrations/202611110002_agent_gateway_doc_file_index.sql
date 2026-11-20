-- doc_status file index: let the status read resolve fileStored/sha256 without
-- pulling full doc.file bodies.
--
-- Root cause (observed 11 Nov 2026): readDocNumberStatus loaded doc.file rows
-- through data_list, which embeds the whole contentBase64 payload (~4 MiB per
-- 3 MiB file, up to ~14 MiB per 10 MiB file). Once several large files were
-- stored, that list failed (statement timeout / oversized response -> 503
-- "Penyimpanan laporan belum tersedia") and the status path reported 404
-- "Dokumen tidak ditemukan" for registered documents. data_list has no
-- projection or offset argument, so no dashboard fetch-size tweak can avoid
-- the bodies server-side; the index below returns only number/sha256 metadata.
--
-- Apply in the Supabase SQL Editor; the agent has no DB access. The dashboard
-- uses this command when available and falls back to the legacy data_list
-- read on databases where this migration has not been applied yet.
begin;

select melinda_private.record_migration('202611110002', '202611110002_agent_gateway_doc_file_index');

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

  else
    return jsonb_build_object('errorCode', 'invalid_command');
  end if;
end;
$$;

revoke all on function public.melinda_agent_gateway(text, jsonb) from public, anon, authenticated;
grant execute on function public.melinda_agent_gateway(text, jsonb) to service_role;

commit;
