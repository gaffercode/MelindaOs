-- Dedicated QA only. Apply both director migrations first; all synthetic rows roll back.
begin;
do $$
declare
  create_args jsonb := jsonb_build_object('reviewerId','qa-reviewer','key','qa-instruction-1','requestHash',repeat('a',64),
    'reportDate','2099-01-01','section','priorities','itemId','p1','itemTitle','Synthetic item','urgent',true,
    'action','request_update','deadline','2099-01-01T16:00','pic','[]'::jsonb,'note','');
  first_result jsonb;
  result jsonb;
  instruction_id text;
begin
  if has_function_privilege('anon', 'public.melinda_director_instructions(text,jsonb)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.melinda_director_instructions(text,jsonb)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.melinda_director_instructions(text,jsonb)', 'EXECUTE') then
    raise exception 'Instruction RPC privilege boundary failed';
  end if;
  if has_table_privilege('service_role', 'melinda_private.instructions', 'SELECT,INSERT,UPDATE,DELETE') then
    raise exception 'Instruction table boundary failed';
  end if;
  first_result := public.melinda_director_instructions('create', create_args);
  instruction_id := first_result->'instruction'->>'id';
  if instruction_id not like 'IOC-%' or first_result->'instruction'->>'status' <> 'dibuat' then raise exception 'Create failed'; end if;
  result := public.melinda_director_instructions('create', create_args);
  if result->'instruction'->>'id' <> instruction_id or result->>'replayed' <> 'true' then raise exception 'Idempotent create failed'; end if;
  result := public.melinda_director_instructions('create', create_args || jsonb_build_object('requestHash', repeat('b',64)));
  if result->>'errorCode' <> 'conflict' then raise exception 'Changed create did not conflict'; end if;
  result := public.melinda_director_instructions('advance', jsonb_build_object('id', instruction_id, 'status', 'diteruskan', 'actor', 'qa-bot'));
  if result->'instruction'->>'status' <> 'diteruskan' or (result->'instruction'->'history'->-1) ? 'note' then raise exception 'Polling advance from dibuat failed'; end if;
  result := public.melinda_director_instructions('mark', jsonb_build_object('id', instruction_id, 'status', 'terkirim_ke_grokbot', 'actor', 'dashboard'));
  if result->>'errorCode' <> 'conflict' then raise exception 'Mark after delivery did not conflict'; end if;
  result := public.melinda_director_instructions('advance', jsonb_build_object('id', instruction_id, 'status', 'dikerjakan', 'actor', 'qa-bot'));
  if result->'instruction'->>'status' <> 'dikerjakan' then raise exception 'Advance failed'; end if;
  result := public.melinda_director_instructions('advance', jsonb_build_object('id', instruction_id, 'status', 'diterima_pic', 'actor', 'qa-bot'));
  if result->>'errorCode' <> 'conflict' then raise exception 'Backward transition accepted'; end if;
  result := public.melinda_director_instructions('advance', jsonb_build_object('id', instruction_id, 'status', 'terkendala', 'actor', 'qa-bot'));
  if result->'instruction'->>'status' <> 'terkendala' or (result->'instruction'->'history'->-1) ? 'note' then raise exception 'Terkendala without a note failed'; end if;
  result := public.melinda_director_instructions('advance', jsonb_build_object('id', instruction_id, 'status', 'terkendala', 'actor', 'qa-bot'));
  if result->>'errorCode' <> 'conflict' then raise exception 'Terkendala without a new note accepted'; end if;
  result := public.melinda_director_instructions('advance', jsonb_build_object('id', instruction_id, 'status', 'terkendala', 'note', 'Menunggu berkas', 'actor', 'qa-bot'));
  if result->'instruction'->>'status' <> 'terkendala' or result->'instruction'->'history'->-1->>'note' <> 'Menunggu berkas' then raise exception 'Terkendala with a note failed'; end if;
  result := public.melinda_director_instructions('advance', jsonb_build_object('id', instruction_id, 'status', 'terkendala', 'note', 'Menunggu berkas', 'actor', 'qa-bot'));
  if result->>'errorCode' <> 'conflict' then raise exception 'Repeated terkendala note accepted'; end if;
  result := public.melinda_director_instructions('advance', jsonb_build_object('id', instruction_id, 'status', 'diterima_pic', 'actor', 'qa-bot'));
  if result->>'errorCode' <> 'conflict' then raise exception 'Terkendala moved backward'; end if;
  result := public.melinda_director_instructions('advance', jsonb_build_object('id', instruction_id, 'status', 'dikerjakan', 'actor', 'qa-bot'));
  if result->'instruction'->>'status' <> 'dikerjakan' then raise exception 'Resume from terkendala failed'; end if;
  result := public.melinda_director_instructions('advance', jsonb_build_object('id', instruction_id, 'status', 'selesai', 'note', repeat('x', 281), 'actor', 'qa-bot'));
  if result->>'errorCode' <> 'invalid_status' then raise exception 'Overlong note accepted'; end if;
  result := public.melinda_director_instructions('advance', jsonb_build_object('id', instruction_id, 'status', 'selesai', 'actor', 'qa-bot'));
  if result->'instruction'->>'status' <> 'selesai' or jsonb_array_length(result->'instruction'->'history') <> 7 then raise exception 'Complete after terkendala failed'; end if;
  result := public.melinda_director_instructions('create', create_args || jsonb_build_object('key','qa-instruction-2'));
  instruction_id := result->'instruction'->>'id';
  result := public.melinda_director_instructions('mark', jsonb_build_object('id', instruction_id, 'status', 'gagal', 'actor', 'dashboard'));
  if result->'instruction'->>'status' <> 'gagal' then raise exception 'Mark gagal failed'; end if;
  result := public.melinda_director_instructions('advance', jsonb_build_object('id', instruction_id, 'status', 'diteruskan', 'actor', 'qa-bot'));
  if result->'instruction'->>'status' <> 'diteruskan' then raise exception 'Advance from gagal failed'; end if;
  result := public.melinda_director_instructions('create', create_args || jsonb_build_object('key','qa-instruction-3'));
  instruction_id := result->'instruction'->>'id';
  result := public.melinda_director_instructions('advance', jsonb_build_object('id', instruction_id, 'status', 'terkendala', 'actor', 'qa-bot'));
  if result->>'errorCode' <> 'conflict' then raise exception 'Terkendala from dibuat without a note accepted'; end if;
  result := public.melinda_director_instructions('advance', jsonb_build_object('id', instruction_id, 'status', 'terkendala', 'note', 'WhatsApp gagal terkirim', 'actor', 'qa-bot'));
  if result->'instruction'->>'status' <> 'terkendala' or result->'instruction'->'history'->-1->>'note' <> 'WhatsApp gagal terkirim' then raise exception 'Terkendala from dibuat with a note failed: apply migration 202610300001'; end if;
  result := public.melinda_director_instructions('advance', jsonb_build_object('id', instruction_id, 'status', 'diteruskan', 'actor', 'qa-bot'));
  if result->'instruction'->>'status' <> 'diteruskan' then raise exception 'Resend after a block before delivery failed'; end if;
  result := public.melinda_director_instructions('advance', jsonb_build_object('id', instruction_id, 'status', 'selesai', 'actor', 'qa-bot'));
  if result->'instruction'->>'status' <> 'selesai' then raise exception 'Advance to selesai after resend failed'; end if;
  result := public.melinda_director_instructions('list', '{"date":"2099-01-01"}');
  if jsonb_array_length(result->'instructions') <> 3 then raise exception 'List failed'; end if;
  result := public.melinda_director_instructions('create', create_args || jsonb_build_object('key','qa-instruction-4','section','umum','itemId','UMUM-20990101-qa','itemTitle','Synthetic free-form item'));
  if result->'instruction'->>'section' <> 'umum' then raise exception 'Free-form (umum) create failed: apply migration 202610280001'; end if;
  begin
    update melinda_private.instructions set status = 'macet' where id = instruction_id;
    raise exception 'Invalid status accepted';
  exception when check_violation then
    null;
  end;
  result := public.melinda_director_instructions('open', '{"from":"2098-12-31","to":"2099-01-01"}');
  if jsonb_array_length(result->'instructions') <> 2 or result->'instructions'->0->>'status' <> 'diteruskan' or result->'instructions'->1->>'section' <> 'umum' then raise exception 'Open window failed: apply migration 202610290002'; end if;
  result := public.melinda_director_instructions('advance', jsonb_build_object('id', result->'instructions'->1->>'id', 'status', 'selesai', 'actor', 'qa-bot'));
  result := public.melinda_director_instructions('open', '{"from":"2098-12-31","to":"2099-01-01"}');
  if jsonb_array_length(result->'instructions') <> 1 then raise exception 'Open window still lists a finished instruction'; end if;
end;
$$;
rollback;
