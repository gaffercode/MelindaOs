-- Synthetic acceptance tests for Melinda action proposals (all data rolled back).
begin;
do $$
declare
  a uuid;
  b uuid;
  conversation uuid;
  result jsonb;
  hash constant text := repeat('a', 64);
  proposal constant jsonb := jsonb_build_object('owner','qa-1','kind','ganti_pic','summary','Tugas QA: PIC A ke B',
    'payload', jsonb_build_object('taskId','QA-1','pic', jsonb_build_array('B')), 'payloadHash', hash);
begin
  if has_function_privilege('anon','public.melinda_actions(text,jsonb)','EXECUTE')
    or has_function_privilege('authenticated','public.melinda_actions(text,jsonb)','EXECUTE')
    or not has_function_privilege('service_role','public.melinda_actions(text,jsonb)','EXECUTE')
    or has_table_privilege('service_role','melinda_private.melinda_actions','SELECT,INSERT,UPDATE,DELETE')
    or has_table_privilege('anon','melinda_private.melinda_actions','SELECT')
    or not (select relrowsecurity from pg_class where oid = 'melinda_private.melinda_actions'::regclass) then
    raise exception 'Melinda actions security boundary failed';
  end if;

  conversation := (public.melinda_agent('create', jsonb_build_object('owner','qa-1','title','QA'))->'conversation'->>'id')::uuid;
  result := public.melinda_actions('propose', proposal || jsonb_build_object('conversationId', conversation));
  a := (result->'action'->>'id')::uuid;
  if a is null or result->'action'->>'status' <> 'pending' then raise exception 'Propose failed: %', result; end if;

  -- Bad input never stores a row.
  foreach result in array array[
    public.melinda_actions('propose', proposal || '{"kind":"hapus_semua"}'),
    public.melinda_actions('propose', proposal || '{"payloadHash":"bukan-hash"}'),
    public.melinda_actions('propose', proposal || '{"summary":"  "}'),
    public.melinda_actions('propose', proposal || '{"ttlSeconds":5}'),
    public.melinda_actions('propose', proposal - 'owner')
  ] loop
    if result->>'errorCode' <> 'invalid_input' then raise exception 'Invalid proposal accepted: %', result; end if;
  end loop;

  -- Another owner sees nothing; a malformed id is not found.
  if public.melinda_actions('claim', jsonb_build_object('owner','qa-2','id',a))->>'errorCode' <> 'not_found'
    or public.melinda_actions('cancel', jsonb_build_object('owner','qa-2','id',a))->>'errorCode' <> 'not_found'
    or public.melinda_actions('claim', jsonb_build_object('owner','qa-1','id','x'))->>'errorCode' <> 'not_found' then
    raise exception 'Owner check failed';
  end if;

  -- finish before claim is refused; claim returns the payload once; a second claim conflicts.
  if public.melinda_actions('finish', jsonb_build_object('owner','qa-1','id',a,'outcome','executed'))->>'errorCode' <> 'conflict' then
    raise exception 'Finish before claim accepted';
  end if;
  result := public.melinda_actions('claim', jsonb_build_object('owner','qa-1','id',a));
  if result->'action'->'payload'->>'taskId' <> 'QA-1' or result->'action'->>'payloadHash' <> hash then
    raise exception 'Claim payload wrong: %', result;
  end if;
  if public.melinda_actions('claim', jsonb_build_object('owner','qa-1','id',a))->>'errorCode' <> 'conflict'
    or public.melinda_actions('cancel', jsonb_build_object('owner','qa-1','id',a))->>'errorCode' <> 'conflict' then
    raise exception 'Second decision accepted';
  end if;
  result := public.melinda_actions('finish', jsonb_build_object('owner','qa-1','id',a,'outcome','executed','result','{"instructionId":"IOC-1"}'::jsonb));
  if result->>'ok' <> 'true' or (select status from melinda_private.melinda_actions where id = a) <> 'executed' then
    raise exception 'Finish failed: %', result;
  end if;

  -- Cancel, then expiry.
  b := (public.melinda_actions('propose', proposal)->'action'->>'id')::uuid;
  if public.melinda_actions('cancel', jsonb_build_object('owner','qa-1','id',b))->>'ok' <> 'true' then raise exception 'Cancel failed'; end if;
  if public.melinda_actions('claim', jsonb_build_object('owner','qa-1','id',b))->>'errorCode' <> 'conflict' then
    raise exception 'Cancelled action claimed';
  end if;
  b := (public.melinda_actions('propose', proposal)->'action'->>'id')::uuid;
  update melinda_private.melinda_actions set expires_at = clock_timestamp() - interval '1 second' where id = b;
  -- Two statements: PostgreSQL may evaluate either side of an OR first.
  result := public.melinda_actions('claim', jsonb_build_object('owner','qa-1','id',b));
  if result->>'errorCode' <> 'expired' or (select status from melinda_private.melinda_actions where id = b) <> 'expired' then
    raise exception 'Expired action claimed';
  end if;

  -- A conversation of another owner is not linked.
  conversation := (public.melinda_agent('create', jsonb_build_object('owner','qa-2','title','QA'))->'conversation'->>'id')::uuid;
  b := (public.melinda_actions('propose', proposal || jsonb_build_object('conversationId', conversation))->'action'->>'id')::uuid;
  if (select conversation_id from melinda_private.melinda_actions where id = b) is not null then
    raise exception 'Foreign conversation linked';
  end if;

  if public.melinda_actions('drop', jsonb_build_object('owner','qa-1'))->>'errorCode' <> 'invalid_command' then
    raise exception 'Unknown command accepted';
  end if;
end $$;
rollback;
