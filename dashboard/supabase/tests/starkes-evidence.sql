begin;
do $$
declare
  r jsonb;
  row_id text;
begin
  if has_table_privilege('anon', 'melinda_private.starkes_evidence', 'SELECT')
     or has_table_privilege('service_role', 'melinda_private.starkes_evidence', 'SELECT') then raise exception 'direct table access'; end if;
  if has_function_privilege('anon', 'public.melinda_starkes_evidence(text,jsonb)', 'EXECUTE') then raise exception 'anon RPC'; end if;
  if not has_function_privilege('service_role', 'public.melinda_starkes_evidence(text,jsonb)', 'EXECUTE') then raise exception 'server RPC missing'; end if;

  r := public.melinda_starkes_evidence('upsert_pending', jsonb_build_object('rows', jsonb_build_array(
    jsonb_build_object('source', 'drive', 'ref', 'f1', 'chapter_code', 'SKP', 'kind', 'D', 'ep_ids', jsonb_build_array('47104-2024:SKP:1:2'),
      'name', 'Audit identifikasi.pdf', 'modified_at', '2026-11-01T00:00:00Z', 'matched_by', 'ai', 'confidence', 0.8),
    jsonb_build_object('source', 'drive', 'ref', 'f2', 'chapter_code', 'SKP', 'kind', 'O', 'ep_ids', '[]'::jsonb, 'modified_at', '2026-11-01T00:00:00Z'))));
  r := public.melinda_starkes_evidence('list', '{}');
  if jsonb_array_length(r->'evidence') <> 2 or r->'evidence'->0->>'status' <> 'pending' then raise exception 'list: %', r; end if;
  select id::text into row_id from melinda_private.starkes_evidence where ref = 'f1';

  r := public.melinda_starkes_evidence('decide_batch', jsonb_build_object('ids', jsonb_build_array(row_id), 'status', 'approved'));
  if (r->>'updated')::int <> 1 then raise exception 'decide: %', r; end if;
  r := public.melinda_starkes_evidence('decide_batch', jsonb_build_object('ids', jsonb_build_array(row_id), 'status', 'withdrawn'));
  if r->>'errorCode' <> 'invalid_status' then raise exception 'decide accepted a non-decision status'; end if;

  -- same file, unchanged: decision kept
  r := public.melinda_starkes_evidence('upsert_pending', jsonb_build_object('rows', jsonb_build_array(
    jsonb_build_object('source', 'drive', 'ref', 'f1', 'chapter_code', 'SKP', 'kind', 'D', 'modified_at', '2026-11-01T00:00:00Z'))));
  if (select status from melinda_private.starkes_evidence where ref = 'f1') <> 'approved' then raise exception 'unchanged file lost its decision'; end if;
  -- moved to another chapter and modified: one row, new chapter, pending again
  r := public.melinda_starkes_evidence('upsert_pending', jsonb_build_object('rows', jsonb_build_array(
    jsonb_build_object('source', 'drive', 'ref', 'f1', 'chapter_code', 'PPI', 'kind', 'D', 'modified_at', '2026-11-05T00:00:00Z'))));
  if (select count(*) from melinda_private.starkes_evidence where ref = 'f1') <> 1
     or (select chapter_code || '/' || status from melinda_private.starkes_evidence where ref = 'f1') <> 'PPI/pending' then raise exception 'move not applied'; end if;

  -- f2 no longer in SKP: withdrawn; a kb row is never withdrawn by a Drive sync
  insert into melinda_private.starkes_evidence(source, ref, chapter_code, kind, status) values ('kb', 'kb-skp', 'SKP', 'R', 'approved');
  r := public.melinda_starkes_evidence('withdraw_missing', jsonb_build_object('chapter_code', 'SKP', 'present_refs', '[]'::jsonb));
  if (r->>'withdrawn')::int <> 1 or (select status from melinda_private.starkes_evidence where ref = 'f2') <> 'withdrawn'
     or (select status from melinda_private.starkes_evidence where ref = 'kb-skp') <> 'approved' then raise exception 'withdraw: %', r; end if;

  r := public.melinda_starkes_evidence('drop', '{}');
  if r->>'errorCode' <> 'invalid_command' then raise exception 'unknown command accepted'; end if;
end $$;
rollback;
