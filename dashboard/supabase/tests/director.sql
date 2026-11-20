-- Dedicated QA only. Apply the migration first; all synthetic rows roll back.
begin;
do $$
declare
  payload jsonb := '{"brief":{"date":"2099-01-01"},"provenance":{}}';
  first_receipt jsonb;
  correction jsonb;
  result jsonb;
  review_args jsonb;
  previous_id uuid;
begin
  if has_function_privilege('anon', 'public.melinda_director(text,jsonb)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.melinda_director(text,jsonb)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.melinda_director(text,jsonb)', 'EXECUTE') then
    raise exception 'RPC privilege boundary failed';
  end if;
  if has_table_privilege('service_role', 'melinda_private.revisions', 'SELECT,INSERT,UPDATE,DELETE') then
    raise exception 'Private table boundary failed';
  end if;
  first_receipt := public.melinda_director('submit', jsonb_build_object('producerId','qa-director','key','qa-first','payloadHash',repeat('a',64),'payload',payload));
  if first_receipt->>'status' <> 'pending' then raise exception 'Submission was not pending'; end if;
  result := public.melinda_director('submit', jsonb_build_object('producerId','qa-director','key','qa-first','payloadHash',repeat('a',64),'payload',payload));
  if result->>'submissionId' <> first_receipt->>'submissionId' or result->>'replayed' <> 'true' then raise exception 'Idempotent submission failed'; end if;
  result := public.melinda_director('submit', jsonb_build_object('producerId','qa-director','key','qa-first','payloadHash',repeat('b',64),'payload',payload));
  if result->>'errorCode' <> 'conflict' then raise exception 'Changed submission did not conflict'; end if;
  result := public.melinda_director('submission_read', jsonb_build_object('producerId','other-producer','id',first_receipt->>'submissionId'));
  if result->>'errorCode' <> 'not_found' then raise exception 'Producer isolation failed'; end if;
  result := public.melinda_director('published', '{"date":"2099-01-01"}');
  if result->'published' <> 'null'::jsonb then raise exception 'Pending draft leaked into publication'; end if;
  review_args := jsonb_build_object('id',first_receipt->>'revisionId','reviewerId','qa-reviewer','key','qa-review-first','requestHash',repeat('c',64),'action','approve-and-publish','payloadHash',repeat('a',64),'expectedPublishedRevisionId',null);
  result := public.melinda_director('review',review_args);
  if result->>'status' <> 'published' then raise exception 'Publication failed'; end if;
  if public.melinda_director('review',review_args) <> result then raise exception 'Review replay failed'; end if;
  previous_id := (result->>'revisionId')::uuid;
  correction := public.melinda_director('submit',jsonb_build_object('producerId','qa-director','key','qa-correction','payloadHash',repeat('d',64),'payload',payload));
  result := public.melinda_director('review',jsonb_build_object('id',correction->>'revisionId','reviewerId','qa-reviewer','key','qa-stale-review','requestHash',repeat('e',64),'action','approve-and-publish','payloadHash',repeat('d',64),'expectedPublishedRevisionId',null));
  if result->>'errorCode' <> 'conflict' then raise exception 'Stale publication expectation accepted'; end if;
  result := public.melinda_director('review',jsonb_build_object('id',correction->>'revisionId','reviewerId','qa-reviewer','key','qa-reject','requestHash',repeat('f',64),'action','reject','reason','Synthetic QA rejection','payloadHash',repeat('d',64),'expectedPublishedRevisionId',previous_id));
  if result->>'status' <> 'rejected' then raise exception 'Rejection failed'; end if;
  result := public.melinda_director('published','{"date":"2099-01-01"}');
  if (result->'published'->>'id')::uuid <> previous_id then raise exception 'Rejection changed publication'; end if;
  perform public.melinda_director('session_create','{"tokenHash":"qa-session","reviewerId":"qa-reviewer","credentialVersion":"qa-v1"}');
  result := public.melinda_director('session_read','{"tokenHash":"qa-session","credentialVersion":"qa-v2"}');
  if result->'session' <> 'null'::jsonb then raise exception 'Credential rotation did not revoke session'; end if;
  update melinda_private.sessions set expires_at = clock_timestamp() - interval '1 second' where token_hash = 'qa-session';
  result := public.melinda_director('session_read','{"tokenHash":"qa-session","credentialVersion":"qa-v1"}');
  if result->'session' <> 'null'::jsonb then raise exception 'Expired session was accepted'; end if;
  for attempt in 1..3 loop
    result := public.melinda_director('rate_limit','{"bucket":"qa-limit","limit":2,"seconds":60}');
    if (result->>'allowed')::boolean is distinct from (attempt <= 2) then raise exception 'Persistent rate limit failed'; end if;
  end loop;
  if (select count(*) from melinda_private.audit where actor = 'qa-reviewer') <> 2 then raise exception 'Review audit duplicated'; end if;
end;
$$;
rollback;
