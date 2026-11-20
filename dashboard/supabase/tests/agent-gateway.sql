-- Dedicated QA only. Apply the migration first; all synthetic rows roll back.
begin;
do $$
declare
  submission jsonb;
  datarec jsonb;
  result jsonb;
  first_draft jsonb;
  third jsonb;
  draft_id uuid;
  other_id uuid;
  other jsonb;
  audit_count int;
  bad jsonb;
begin
  if has_function_privilege('anon', 'public.melinda_agent_gateway(text,jsonb)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.melinda_agent_gateway(text,jsonb)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.melinda_agent_gateway(text,jsonb)', 'EXECUTE') then
    raise exception 'RPC privilege boundary failed';
  end if;
  if has_table_privilege('service_role', 'melinda_private.agent_knowledge_submissions', 'SELECT,INSERT,UPDATE,DELETE')
    or has_table_privilege('service_role', 'melinda_private.agent_data_records', 'SELECT,INSERT,UPDATE,DELETE') then
    raise exception 'Private table boundary failed';
  end if;

  submission := public.melinda_agent_gateway('knowledge_submit', jsonb_build_object(
    'producer','qa-agent','key','qa-knowledge-1','requestHash',repeat('a',64),
    'title','Synthetic draft','category','A','content','# Draft','docId','KB-QA-1'));
  if submission->'submission'->>'status' <> 'submitted' or submission->>'replayed' <> 'false' then
    raise exception 'Knowledge submission was not stored as submitted';
  end if;
  result := public.melinda_agent_gateway('knowledge_submit', jsonb_build_object(
    'producer','qa-agent','key','qa-knowledge-1','requestHash',repeat('a',64),
    'title','Synthetic draft','category','A','content','# Draft','docId','KB-QA-1'));
  if result->>'replayed' <> 'true'
    or result->'submission'->>'id' <> submission->'submission'->>'id' then
    raise exception 'Knowledge idempotent replay failed';
  end if;
  result := public.melinda_agent_gateway('knowledge_submit', jsonb_build_object(
    'producer','qa-agent','key','qa-knowledge-1','requestHash',repeat('b',64),
    'title','Changed','category','A','content','x'));
  if result->>'errorCode' <> 'conflict' then raise exception 'Changed knowledge payload did not conflict'; end if;

  result := public.melinda_agent_gateway('knowledge_read', jsonb_build_object(
    'producer','other-agent','id',submission->'submission'->>'id'));
  if result->>'errorCode' <> 'not_found' then raise exception 'Knowledge producer isolation failed'; end if;
  result := public.melinda_agent_gateway('knowledge_read', jsonb_build_object(
    'producer','qa-agent','id',submission->'submission'->>'id'));
  if result->'submission'->>'content' <> '# Draft' then raise exception 'Knowledge read failed'; end if;
  result := public.melinda_agent_gateway('knowledge_list', '{"producer":"qa-agent"}');
  if jsonb_array_length(result->'submissions') <> 1 then raise exception 'Knowledge list failed'; end if;

  datarec := public.melinda_agent_gateway('data_submit', jsonb_build_object(
    'producer','qa-agent','key','qa-data-1','requestHash',repeat('c',64),
    'kind','ops.note','title','Synthetic note','payload','{"unit":"QA"}'::jsonb,
    'occurredAt','2026-11-10T08:00:00+07:00','url','https://example.invalid/x'));
  if datarec->'record'->>'kind' <> 'ops.note' or datarec->>'replayed' <> 'false' then
    raise exception 'Data record was not stored';
  end if;
  result := public.melinda_agent_gateway('data_list', '{"kind":"ops.note","producer":"qa-agent"}');
  if jsonb_array_length(result->'records') <> 1 then raise exception 'Data list filter failed'; end if;
  result := public.melinda_agent_gateway('data_list', '{"kind":"ops.other","producer":"qa-agent"}');
  if jsonb_array_length(result->'records') <> 0 then raise exception 'Data kind filter failed'; end if;
  result := public.melinda_agent_gateway('data_list', '{"producer":"qa-agent","since":"2026-11-11T00:00:00+07:00"}');
  if jsonb_array_length(result->'records') <> 0 then raise exception 'Data since filter failed'; end if;
  result := public.melinda_agent_gateway('data_submit', jsonb_build_object(
    'producer','qa-agent','key','qa-data-1','requestHash',repeat('d',64),
    'kind','ops.note','payload','{}'::jsonb));
  if result->>'errorCode' <> 'conflict' then raise exception 'Changed data payload did not conflict'; end if;

  datarec := public.melinda_agent_gateway('data_submit', jsonb_build_object(
    'producer','qa-agent','key','qa-file-1','requestHash',repeat('e',64),
    'kind','doc.file','title','QA file','payload','{"number":"QA-1","sha256":"ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff","filename":"qa.pdf","contentBase64":"eA=="}'::jsonb));
  if datarec->'record'->>'kind' <> 'doc.file' then raise exception 'Doc file was not stored'; end if;
  result := public.melinda_agent_gateway('doc_file_index', '{"producer":"qa-agent"}');
  if jsonb_array_length(result->'records') <> 1 then raise exception 'Doc file index failed'; end if;
  if result->'records'->0->>'sha256' <> 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff' then raise exception 'Doc file index sha mismatch'; end if;
  if result->'records'->0 ? 'payload' then raise exception 'Doc file index leaks payload'; end if;

  if (select count(*) from melinda_private.agent_audit where actor = 'qa-agent') <> 3 then
    raise exception 'Agent audit rows missing';
  end if;
  first_draft := public.melinda_agent_gateway('knowledge_submit', jsonb_build_object(
    'producer','qa-agent-review','key','qa-review-1','requestHash',repeat('e',64),
    'title','Review draft one','category','B','content','# Draft'));
  draft_id := (first_draft->'submission'->>'id')::uuid;
  other := public.melinda_agent_gateway('knowledge_submit', jsonb_build_object(
    'producer','qa-agent-other','key','qa-review-2','requestHash',repeat('f',64),
    'title','Review draft two','category','B','content','# Other'));
  other_id := (other->'submission'->>'id')::uuid;
  if first_draft->'submission'->'reviewNote' is distinct from 'null'::jsonb or first_draft->'submission'->'reviewedAt' is distinct from 'null'::jsonb then
    raise exception 'Knowledge submit lacks reviewedAt/reviewNote';
  end if;

  result := public.melinda_agent_gateway('review_list', '{"status":"submitted"}');
  if (select count(*) from jsonb_array_elements(result->'submissions') e where e->>'id' in (draft_id::text, other_id::text)) is distinct from 2 then
    raise exception 'Review list misses submitted drafts';
  end if;
  if exists (select 1 from jsonb_array_elements(result->'submissions') e where e ? 'content') then
    raise exception 'Review list leaks content';
  end if;
  result := public.melinda_agent_gateway('review_list', '{"status":"accepted"}');
  if jsonb_array_length(result->'submissions') is distinct from 0 then raise exception 'Review list ignores the status filter'; end if;

  result := public.melinda_agent_gateway('review_read', jsonb_build_object('id', draft_id));
  if result->'submission'->>'content' is distinct from '# Draft' or result->'submission'->>'producer' is distinct from 'qa-agent-review' then
    raise exception 'Review read failed';
  end if;
  result := public.melinda_agent_gateway('review_read', jsonb_build_object('id', gen_random_uuid()));
  if result->>'errorCode' is distinct from 'not_found' then raise exception 'Review read of an unknown id did not return not_found'; end if;

  result := public.melinda_agent_gateway('review_decide', jsonb_build_object(
    'id', draft_id, 'decision', 'rejected', 'note', '', 'reviewer', 'qa-director'));
  if result->>'errorCode' is distinct from 'invalid_command' then raise exception 'Reject without a note was accepted'; end if;
  if (select status from melinda_private.agent_knowledge_submissions where id = draft_id) is distinct from 'submitted' then
    raise exception 'Invalid reject changed the status';
  end if;
  for bad in select jsonb_array_elements(jsonb_build_array(
    jsonb_build_object('reviewer', 'qa-director'),
    jsonb_build_object('decision', 'maybe', 'reviewer', 'qa-director'),
    jsonb_build_object('decision', 'rejected', 'note', '   ', 'reviewer', 'qa-director'),
    jsonb_build_object('decision', 'accepted'),
    jsonb_build_object('decision', 'accepted', 'reviewer', ''))) loop
    result := public.melinda_agent_gateway('review_decide', bad || jsonb_build_object('id', draft_id));
    if result->>'errorCode' is distinct from 'invalid_command' then
      raise exception 'Review decide accepted bad arguments: %', bad;
    end if;
    if (select status from melinda_private.agent_knowledge_submissions where id = draft_id) is distinct from 'submitted' then
      raise exception 'Bad review arguments changed the status: %', bad;
    end if;
  end loop;

  result := public.melinda_agent_gateway('review_decide', jsonb_build_object(
    'id', draft_id, 'decision', 'accepted', 'reviewer', 'qa-director'));
  if result->'submission'->>'status' is distinct from 'accepted' or result->>'replayed' is distinct from 'false'
    or coalesce(result->'submission'->'reviewedAt', 'null'::jsonb) = 'null'::jsonb or result->'submission'->'reviewNote' is distinct from 'null'::jsonb
    or result->'submission'->>'content' is distinct from '# Draft' then
    raise exception 'Accept failed';
  end if;
  result := public.melinda_agent_gateway('review_decide', jsonb_build_object(
    'id', draft_id, 'decision', 'accepted', 'reviewer', 'qa-director'));
  if result->>'replayed' is distinct from 'true' or result->'submission'->>'status' is distinct from 'accepted' then
    raise exception 'Accept replay failed';
  end if;
  select count(*) into audit_count from melinda_private.agent_audit where ref_id = draft_id and action = 'review_accepted';
  if audit_count is distinct from 1 then raise exception 'Review audit row count is %', audit_count; end if;
  result := public.melinda_agent_gateway('review_decide', jsonb_build_object(
    'id', draft_id, 'decision', 'rejected', 'note', 'Terlambat', 'reviewer', 'qa-director'));
  if result->>'errorCode' is distinct from 'conflict' then raise exception 'Reject after accept did not conflict'; end if;
  if (select status from melinda_private.agent_knowledge_submissions where id = draft_id) is distinct from 'accepted' then
    raise exception 'Conflicting decision changed the status';
  end if;

  result := public.melinda_agent_gateway('review_decide', jsonb_build_object(
    'id', other_id, 'decision', 'rejected', 'note', 'Sumber belum jelas', 'reviewer', 'qa-director'));
  if result->'submission'->>'status' is distinct from 'rejected' or result->'submission'->>'reviewNote' is distinct from 'Sumber belum jelas' then
    raise exception 'Reject failed';
  end if;

  result := public.melinda_agent_gateway('knowledge_read', jsonb_build_object('producer','qa-agent-other','id', other_id));
  if result->'submission'->>'status' is distinct from 'rejected' or result->'submission'->>'reviewNote' is distinct from 'Sumber belum jelas'
    or coalesce(result->'submission'->'reviewedAt', 'null'::jsonb) = 'null'::jsonb then
    raise exception 'Producer cannot see the review outcome';
  end if;
  result := public.melinda_agent_gateway('knowledge_list', '{"producer":"qa-agent-other"}');
  if not coalesce(result->'submissions'->0 ? 'reviewNote', false) or not coalesce(result->'submissions'->0 ? 'reviewedAt', false)
    or result->'submissions'->0->>'reviewNote' is distinct from 'Sumber belum jelas' then
    raise exception 'Knowledge list lacks review fields';
  end if;

  result := public.melinda_agent_gateway('review_decide', jsonb_build_object(
    'id', gen_random_uuid(), 'decision', 'accepted', 'reviewer', 'qa-director'));
  if result->>'errorCode' is distinct from 'not_found' then raise exception 'Review decide of an unknown id did not return not_found'; end if;

  third := public.melinda_agent_gateway('knowledge_submit', jsonb_build_object(
    'producer','qa-agent-review','key','qa-review-3','requestHash',repeat('9',64),
    'title','Review draft three','category','C','content','x'));
  begin
    update melinda_private.agent_knowledge_submissions
      set status = 'rejected', reviewed_by = 'qa-director', reviewed_at = clock_timestamp(), review_note = null
      where id = (third->'submission'->>'id')::uuid;
    raise exception 'A rejected row without a review note was stored';
  exception when check_violation then
    null;
  end;

  result := public.melinda_agent_gateway('bogus', '{}');
  if result->>'errorCode' <> 'invalid_command' then raise exception 'Unknown command accepted'; end if;
end;
$$;
rollback;
