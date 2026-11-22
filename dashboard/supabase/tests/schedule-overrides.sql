-- Synthetic acceptance tests for schedule overrides (all data rolled back).
begin;
do $$
declare
  result jsonb;
  first_id text;
  base constant jsonb := jsonb_build_object('date','2026-11-23','role','direktur','producer','qa');
begin
  if has_function_privilege('anon','public.melinda_schedule_overrides(text,jsonb)','EXECUTE')
    or has_function_privilege('authenticated','public.melinda_schedule_overrides(text,jsonb)','EXECUTE')
    or not has_function_privilege('service_role','public.melinda_schedule_overrides(text,jsonb)','EXECUTE')
    or has_table_privilege('service_role','melinda_private.schedule_overrides','SELECT,INSERT,UPDATE,DELETE')
    or not (select relrowsecurity from pg_class where oid = 'melinda_private.schedule_overrides'::regclass) then
    raise exception 'Schedule overrides security boundary failed';
  end if;

  result := public.melinda_schedule_overrides('add', base || '{"key":"qa-1","kind":"add","start":"10:00","end":"11:00","title":"Rapat QA"}');
  first_id := result->'override'->>'id';
  if first_id is null or result->'override'->>'title' <> 'Rapat QA' then raise exception 'Add failed: %', result; end if;
  -- The same key returns the stored row and inserts nothing.
  result := public.melinda_schedule_overrides('add', base || '{"key":"qa-1","kind":"add","start":"12:00","title":"Lain"}');
  if result->'override'->>'id' <> first_id or result->'override'->>'start' <> '10:00' then raise exception 'Replay changed the row: %', result; end if;

  perform public.melinda_schedule_overrides('add', base || '{"key":"qa-2","kind":"cancel","slotId":"slot-1"}');
  perform public.melinda_schedule_overrides('add', base || '{"key":"qa-3","kind":"move","slotId":"slot-2","start":"14:00"}');
  perform public.melinda_schedule_overrides('add', (base || '{"key":"qa-4","kind":"cancel","slotId":"slot-9"}') || '{"role":"wadir_ops"}');

  foreach result in array array[
    public.melinda_schedule_overrides('add', base || '{"key":"qa-5","kind":"add","title":"Tanpa jam"}'),
    public.melinda_schedule_overrides('add', base || '{"key":"qa-6","kind":"move","start":"09:00"}'),
    public.melinda_schedule_overrides('add', base || '{"key":"qa-7","kind":"cancel"}'),
    public.melinda_schedule_overrides('add', base || '{"key":"qa-8","kind":"add","start":"25:00","title":"Jam salah"}'),
    public.melinda_schedule_overrides('add', base || '{"key":"qa-9","kind":"add","start":"10:00","end":"09:00","title":"Mundur"}'),
    public.melinda_schedule_overrides('add', (base || '{"key":"qa-10","kind":"cancel","slotId":"x"}') || '{"role":"bupati"}'),
    public.melinda_schedule_overrides('add', base || '{"kind":"cancel","slotId":"x"}'),
    public.melinda_schedule_overrides('add', jsonb_build_object('date','bukan','key','qa-11'))
  ] loop
    if result->>'errorCode' <> 'invalid_input' then raise exception 'Invalid override accepted: %', result; end if;
  end loop;

  result := public.melinda_schedule_overrides('list', jsonb_build_object('date','2026-11-23','role','direktur'));
  if jsonb_array_length(result->'overrides') <> 3 or result->'overrides'->0->>'kind' <> 'add' then raise exception 'List by role wrong: %', result; end if;
  result := public.melinda_schedule_overrides('list', jsonb_build_object('date','2026-11-23'));
  if jsonb_array_length(result->'overrides') <> 4 then raise exception 'List of the day wrong: %', result; end if;
  if public.melinda_schedule_overrides('drop', jsonb_build_object('date','2026-11-23'))->>'errorCode' <> 'invalid_command' then
    raise exception 'Unknown command accepted';
  end if;
end $$;
rollback;
