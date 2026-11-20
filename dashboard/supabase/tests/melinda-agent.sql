-- Synthetic acceptance tests for the Melinda agent history (all data rolled back).
begin;
do $$
declare
  a uuid;
  result jsonb;
begin
  if has_function_privilege('anon','public.melinda_agent(text,jsonb)','EXECUTE')
    or has_function_privilege('authenticated','public.melinda_agent(text,jsonb)','EXECUTE')
    or not has_function_privilege('service_role','public.melinda_agent(text,jsonb)','EXECUTE')
    or has_table_privilege('service_role','melinda_private.melinda_messages','SELECT')
    or has_table_privilege('service_role','melinda_private.melinda_conversations','SELECT') then
    raise exception 'Melinda agent security boundary failed';
  end if;

  result := public.melinda_agent('create', jsonb_build_object('owner','qa-1','title','  Jadwal hari ini  '));
  a := (result->'conversation'->>'id')::uuid;
  if result->'conversation'->>'title' <> 'Jadwal hari ini' then raise exception 'Title not trimmed: %', result; end if;

  -- Another owner reads every command on this conversation as not found.
  foreach result in array array[
    public.melinda_agent('read', jsonb_build_object('owner','qa-2','id',a)),
    public.melinda_agent('delete', jsonb_build_object('owner','qa-2','id',a)),
    public.melinda_agent('append', jsonb_build_object('owner','qa-2','conversationId',a,'role','user','content','x')),
    public.melinda_agent('history', jsonb_build_object('owner','qa-2','conversationId',a,'limit',20))
  ] loop
    if result->>'errorCode' <> 'not_found' then raise exception 'Owner check failed: %', result; end if;
  end loop;

  result := public.melinda_agent('read', jsonb_build_object('owner','qa-1','id','bukan-uuid'));
  if result->>'errorCode' <> 'not_found' then raise exception 'Malformed id accepted: %', result; end if;

  perform public.melinda_agent('append', jsonb_build_object('owner','qa-1','conversationId',a,'role','assistant','content','pembuka','tokens',5));
  perform public.melinda_agent('append', jsonb_build_object('owner','qa-1','conversationId',a,'role','user','content','tanya','tokens',7));
  perform public.melinda_agent('append', jsonb_build_object('owner','qa-1','conversationId',a,'role','tool','content','hasil alat','toolCalls','[{"name":"baca_tugas"}]'::jsonb));
  perform public.melinda_agent('append', jsonb_build_object('owner','qa-1','conversationId',a,'role','assistant','content','jawab','tokens',11,'complete',false,'sources','[{"label":"SPO","href":"/knowledge?q=a"}]'::jsonb));

  result := public.melinda_agent('history', jsonb_build_object('owner','qa-1','conversationId',a,'limit',20));
  if result->'messages'->0->>'role' <> 'user' or jsonb_array_length(result->'messages') <> 2 then
    raise exception 'History must open on a user turn and skip tool rows: %', result;
  end if;
  result := public.melinda_agent('history', jsonb_build_object('owner','qa-1','conversationId',a,'limit',1));
  if jsonb_array_length(result->'messages') <> 0 then raise exception 'A window holding only an assistant turn must be empty: %', result; end if;

  result := public.melinda_agent('read', jsonb_build_object('owner','qa-1','id',a));
  if jsonb_array_length(result->'messages') <> 3 or result->'messages'->2->>'complete' <> 'false' or result->'messages'->2->'sources'->0->>'label' <> 'SPO' then
    raise exception 'Read shape failed: %', result;
  end if;

  result := public.melinda_agent('usage_today', jsonb_build_object('owner','qa-1','day',to_char(now() at time zone 'Asia/Jakarta','YYYY-MM-DD')));
  if (result->>'tokens')::int <> 23 then raise exception 'Usage sum failed: %', result; end if;

  result := public.melinda_agent('append', jsonb_build_object('owner','qa-1','conversationId',a,'role','system','content','x'));
  if result->>'errorCode' <> 'invalid_input' then raise exception 'Invalid role accepted: %', result; end if;

  result := public.melinda_agent('list', jsonb_build_object('owner','qa-1'));
  if jsonb_array_length(result->'conversations') <> 1 then raise exception 'List failed: %', result; end if;

  perform public.melinda_agent('delete', jsonb_build_object('owner','qa-1','id',a));
  if exists (select 1 from melinda_private.melinda_messages m where m.conversation_id = a) then raise exception 'Delete left messages behind'; end if;
end $$;
rollback;
