begin;
do $$
declare
  p jsonb := '{"id":"11111111-1111-4111-8111-111111111111","revision":1,"status":"signed","documents":[],"review":null}'::jsonb;
  actor jsonb := '{"role":"mutu","reviewerId":"synthetic"}'::jsonb;
  r jsonb;
  t text;
begin
  foreach t in array array['studio_packages','studio_revisions','studio_events','studio_number_series','studio_number_allocations'] loop
    if has_table_privilege('anon','melinda_private.'||t,'SELECT') or has_table_privilege('authenticated','melinda_private.'||t,'UPDATE') or has_table_privilege('service_role','melinda_private.'||t,'SELECT') then raise exception 'direct table access: %',t; end if;
  end loop;
  if has_function_privilege('anon','public.melinda_studio_documents(text,jsonb)','EXECUTE') then raise exception 'anon RPC'; end if;
  if not has_function_privilege('service_role','public.melinda_studio_documents(text,jsonb)','EXECUTE') then raise exception 'server RPC missing'; end if;
  r := public.melinda_studio_documents('create',jsonb_build_object('pkg',p,'contentHash','abc','actor',actor));
  if r->'result'->>'status' <> 'draft' then raise exception 'status forgery'; end if;
  r := public.melinda_studio_documents('review',jsonb_build_object('id',p->>'id','expectedRevision',1,'revisionHash','abc','actor',actor));
  if r->'result'->>'status' <> 'in_review' or (r->'result'->>'revision')::integer <> 2 then raise exception 'review failed: %',r; end if;
  r := public.melinda_studio_documents('save',jsonb_build_object('pkg',p,'expectedRevision',1,'contentHash','def','actor',actor));
  if r->>'errorCode' <> 'conflict' then raise exception 'stale write accepted'; end if;
  if (select count(*) from melinda_private.studio_revisions where package_id=(p->>'id')::uuid) <> 2 then raise exception 'history lost'; end if;
  update melinda_private.studio_packages set payload=payload || '{"snapshotHash":"source","baselineId":"baseline","applicabilityHash":"ap","applicability":{},"requiredFactKeys":[],"documents":[{"id":"spo","kind":"spo","authority":"director"}]}'::jsonb where id=(p->>'id')::uuid;
  insert into melinda_private.studio_number_series values('spo','{seq}/SPO/{year}',1,'director','["source"]',true);
  r := public.melinda_studio_documents('finalize',jsonb_build_object('id',p->>'id','expectedRevision',2,'requestId','req','issueDate','2026-11-05','revisionHash','abc','snapshotHash','source','baselineId','baseline','applicabilityHash','ap','actor',actor));
  if r->>'errorCode' <> 'forbidden' then raise exception 'mutu finalized'; end if;
  actor := '{"role":"director","reviewerId":"director-test"}';
  r := public.melinda_studio_documents('finalize',jsonb_build_object('id',p->>'id','expectedRevision',2,'requestId','req','issueDate','2026-11-05','revisionHash','abc','snapshotHash','source','baselineId','baseline','applicabilityHash','ap','actor',actor));
  if r->'result'->'documents'->0->>'number' <> '001/SPO/2026' or r->'result'->>'status' <> 'ready_for_signature' then raise exception 'finalization failed: %',r; end if;
  r := public.melinda_studio_documents('finalize',jsonb_build_object('id',p->>'id','expectedRevision',2,'requestId','req','issueDate','2026-11-05','snapshotHash','source','baselineId','baseline','applicabilityHash','ap','actor',actor));
  if r->'result'->'documents'->0->>'number' <> '001/SPO/2026' or (select next_sequence from melinda_private.studio_number_series where id='spo') <> 2 then raise exception 'replay reallocated number'; end if;
end $$;
rollback;
