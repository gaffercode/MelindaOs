-- Dedicated QA only. Apply 202611120002_director_answers first; every synthetic row rolls back.
begin;
do $$
declare
  r jsonb;
  c record;
  rows_before bigint;
  rows_after bigint;
  first_at timestamptz;
  second_at timestamptz;
  fn text := 'public.melinda_director_answers(text,jsonb)';
  invalid constant jsonb := '{"errorCode": "invalid_command"}';
  id_a constant text := '00000000000000aa';
  id_b constant text := '00000000000000bb';
  id_c constant text := '00000000000000cc';
  slot constant jsonb := '{"column": 9, "placeholder": "[ISI]", "decision": "value", "text": "dr. QA"}';
  good constant jsonb := jsonb_build_object('reviewer', 'qa-reviewer', 'item', jsonb_build_object(
    'id', id_a, 'docPath', '01_GOVERNANCE/qa.md', 'lineText', '| Nama | [ISI] |', 'slots', jsonb_build_array(slot)));
  -- the invalid cases use an id that has no row, so a wrongly accepted call changes the row count
  bad constant jsonb := jsonb_set(good, '{item,id}', to_jsonb(id_c));
begin
  -- privilege and table boundary
  if has_function_privilege('anon', fn, 'EXECUTE')
    or has_function_privilege('authenticated', fn, 'EXECUTE')
    or not has_function_privilege('service_role', fn, 'EXECUTE') then
    raise exception 'RPC privilege boundary failed';
  end if;
  if has_table_privilege('service_role', 'melinda_private.director_answers', 'SELECT,INSERT,UPDATE,DELETE')
    or has_table_privilege('anon', 'melinda_private.director_answers', 'SELECT')
    or has_table_privilege('authenticated', 'melinda_private.director_answers', 'SELECT') then
    raise exception 'Answers table boundary failed';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'melinda_private.director_answers'::regclass) then
    raise exception 'Row level security is not enabled on director_answers';
  end if;

  -- nothing stored: an empty array, not null
  r := public.melinda_director_answers('list', '{}');
  if r is distinct from '{"answers": []}'::jsonb then raise exception 'empty list is not an empty array: %', r; end if;

  -- set one line, list it back with exactly the six keys
  r := public.melinda_director_answers('set', good);
  if r is distinct from '{"saved": 1}'::jsonb then raise exception 'set did not save 1: %', r; end if;
  r := public.melinda_director_answers('list', '{}');
  if jsonb_typeof(r->'answers') is distinct from 'array' or jsonb_array_length(r->'answers') is distinct from 1 then
    raise exception 'list did not return the one row: %', r;
  end if;
  if (select array_agg(k order by k) from jsonb_object_keys(r->'answers'->0) k)
     is distinct from array['answeredAt', 'answeredBy', 'docPath', 'id', 'lineText', 'slots'] then
    raise exception 'list row does not carry exactly the six keys: %', r;
  end if;
  select answered_at into first_at from melinda_private.director_answers where item_id = id_a;
  if r->'answers'->0->>'id' is distinct from id_a
    or r->'answers'->0->>'docPath' is distinct from '01_GOVERNANCE/qa.md'
    or r->'answers'->0->>'lineText' is distinct from '| Nama | [ISI] |'
    or r->'answers'->0->'slots' is distinct from jsonb_build_array(slot)
    or r->'answers'->0->>'answeredBy' is distinct from 'qa-reviewer'
    or jsonb_typeof(r->'answers'->0->'answeredAt') is distinct from 'string'
    or (r->'answers'->0->>'answeredAt')::timestamptz is distinct from first_at then
    raise exception 'list row does not match what was set: %', r;
  end if;

  -- a second set on the same id replaces the row in place and moves answered_at forward
  perform pg_sleep(0.01);
  r := public.melinda_director_answers('set', jsonb_build_object('reviewer', 'qa-reviewer-2', 'item', jsonb_build_object(
    'id', id_a, 'docPath', '01_GOVERNANCE/qa-2.md', 'lineText', '| Nama | [CEK] dr. QA | [ISI] |',
    'slots', jsonb_build_array(jsonb_build_object('column', 9, 'placeholder', '[CEK]', 'decision', 'confirm', 'text', ''),
                               jsonb_build_object('column', 24, 'placeholder', '[ISI]', 'decision', 'skip', 'text', '')))));
  if r is distinct from '{"saved": 1}'::jsonb then raise exception 'second set did not save 1: %', r; end if;
  select answered_at into second_at from melinda_private.director_answers where item_id = id_a;
  if (select count(*) from melinda_private.director_answers) is distinct from 1
    or (select answered_by from melinda_private.director_answers where item_id = id_a) is distinct from 'qa-reviewer-2'
    or (select doc_path from melinda_private.director_answers where item_id = id_a) is distinct from '01_GOVERNANCE/qa-2.md'
    or (select line_text from melinda_private.director_answers where item_id = id_a) is distinct from '| Nama | [CEK] dr. QA | [ISI] |'
    or (select slots from melinda_private.director_answers where item_id = id_a) is distinct from
       '[{"column": 9, "placeholder": "[CEK]", "decision": "confirm", "text": ""}, {"column": 24, "placeholder": "[ISI]", "decision": "skip", "text": ""}]'::jsonb
    or second_at is null or second_at <= first_at then
    raise exception 'second set did not replace in place (% -> %)', first_at, second_at;
  end if;

  -- newest first: the row touched last leads
  perform pg_sleep(0.01);
  perform public.melinda_director_answers('set', jsonb_set(good, '{item,id}', to_jsonb(id_b)));
  r := public.melinda_director_answers('list', '{}');
  if jsonb_array_length(r->'answers') is distinct from 2
    or r->'answers'->0->>'id' is distinct from id_b or r->'answers'->1->>'id' is distinct from id_a then
    raise exception 'list is not newest first after a new row: %', r;
  end if;
  perform pg_sleep(0.01);
  perform public.melinda_director_answers('set', good);
  r := public.melinda_director_answers('list', '{}');
  if r->'answers'->0->>'id' is distinct from id_a or r->'answers'->1->>'id' is distinct from id_b then
    raise exception 'list is not newest first after a replaced row: %', r;
  end if;

  -- a slot is stored with its four fields only; a whole-number column is stored as an integer
  perform public.melinda_director_answers('set', jsonb_set(good, '{item,slots}',
    '[{"column": 9.0, "placeholder": "[ISI]", "decision": "correction", "text": "salah", "extra": "x"}]'));
  if (select slots from melinda_private.director_answers where item_id = id_a) is distinct from
     '[{"column": 9, "placeholder": "[ISI]", "decision": "correction", "text": "salah"}]'::jsonb
    or (select slots->0->>'column' from melinda_private.director_answers where item_id = id_a) is distinct from '9' then
    raise exception 'a slot was not stored with its four fields only';
  end if;

  -- boundary values are accepted: 300-character path, 2000-character line, 80-character reviewer, 12 slots,
  -- columns 0 and 2000, a 200-character placeholder, a 300-character text
  r := public.melinda_director_answers('set', jsonb_build_object('reviewer', repeat('r', 80), 'item', jsonb_build_object(
    'id', id_a, 'docPath', repeat('p', 300), 'lineText', repeat('l', 2000),
    'slots', (select jsonb_agg(jsonb_build_object('column', case g when 1 then 0 when 2 then 2000 else g end,
                                                  'placeholder', repeat('h', 200), 'decision', 'value', 'text', repeat('t', 300)))
                from generate_series(1, 12) g))));
  if r is distinct from '{"saved": 1}'::jsonb then raise exception 'boundary values refused: %', r; end if;
  if (select jsonb_array_length(slots) from melinda_private.director_answers where item_id = id_a) is distinct from 12 then
    raise exception '12 slots were not stored';
  end if;

  -- clear removes one row, then reports that nothing was left to remove
  r := public.melinda_director_answers('clear', jsonb_build_object('id', id_b));
  if r is distinct from '{"cleared": 1}'::jsonb then raise exception 'clear did not report 1: %', r; end if;
  r := public.melinda_director_answers('clear', jsonb_build_object('id', id_b));
  if r is distinct from '{"cleared": 0}'::jsonb then raise exception 'second clear did not report 0: %', r; end if;
  if exists (select 1 from melinda_private.director_answers where item_id = id_b)
    or not exists (select 1 from melinda_private.director_answers where item_id = id_a) then
    raise exception 'clear removed the wrong rows';
  end if;

  -- every invalid set returns invalid_command and leaves the row count unchanged
  for c in
    select * from (values
      ('args an array', '[]'::jsonb),
      ('args a string', '"set"'::jsonb),
      ('args json null', 'null'::jsonb),
      ('reviewer missing', bad - 'reviewer'),
      ('reviewer null', jsonb_set(bad, '{reviewer}', 'null')),
      ('reviewer empty', jsonb_set(bad, '{reviewer}', '""')),
      ('reviewer 81 characters', jsonb_set(bad, '{reviewer}', to_jsonb(repeat('r', 81)))),
      ('reviewer not a string', jsonb_set(bad, '{reviewer}', '5')),
      ('item missing', bad - 'item'),
      ('item an array', jsonb_set(bad, '{item}', '[]')),
      ('id missing', bad #- '{item,id}'),
      ('id 15 hex', jsonb_set(bad, '{item,id}', '"0000000000000cc"')),
      ('id 17 hex', jsonb_set(bad, '{item,id}', '"000000000000000cc"')),
      ('id uppercase hex', jsonb_set(bad, '{item,id}', '"00000000000000CC"')),
      ('id not hex', jsonb_set(bad, '{item,id}', '"00000000000000zz"')),
      ('id a number', jsonb_set(bad, '{item,id}', '1234567890123456')),
      ('id with a trailing newline', jsonb_set(bad, '{item,id}', to_jsonb(id_c || E'\n'))),
      ('docPath missing', bad #- '{item,docPath}'),
      ('docPath empty', jsonb_set(bad, '{item,docPath}', '""')),
      ('docPath 301 characters', jsonb_set(bad, '{item,docPath}', to_jsonb(repeat('p', 301)))),
      ('docPath a number', jsonb_set(bad, '{item,docPath}', '7')),
      ('lineText missing', bad #- '{item,lineText}'),
      ('lineText empty', jsonb_set(bad, '{item,lineText}', '""')),
      ('lineText 2001 characters', jsonb_set(bad, '{item,lineText}', to_jsonb(repeat('l', 2001)))),
      ('slots missing', bad #- '{item,slots}'),
      ('slots an object', jsonb_set(bad, '{item,slots}', slot)),
      ('slots empty', jsonb_set(bad, '{item,slots}', '[]')),
      ('13 slots', jsonb_set(bad, '{item,slots}', (select jsonb_agg(slot) from generate_series(1, 13)))),
      ('slot a string', jsonb_set(bad, '{item,slots}', '["[ISI]"]')),
      ('slot an array', jsonb_set(bad, '{item,slots}', '[[9, "[ISI]"]]')),
      ('slot null', jsonb_set(bad, '{item,slots}', '[null]')),
      ('column missing', bad #- '{item,slots,0,column}'),
      ('column a string', jsonb_set(bad, '{item,slots,0,column}', '"9"')),
      ('column null', jsonb_set(bad, '{item,slots,0,column}', 'null')),
      ('column 2001', jsonb_set(bad, '{item,slots,0,column}', '2001')),
      ('column -1', jsonb_set(bad, '{item,slots,0,column}', '-1')),
      ('column 1.5', jsonb_set(bad, '{item,slots,0,column}', '1.5')),
      ('placeholder missing', bad #- '{item,slots,0,placeholder}'),
      ('placeholder empty', jsonb_set(bad, '{item,slots,0,placeholder}', '""')),
      ('placeholder 201 characters', jsonb_set(bad, '{item,slots,0,placeholder}', to_jsonb(repeat('h', 201)))),
      ('placeholder a number', jsonb_set(bad, '{item,slots,0,placeholder}', '3')),
      ('decision missing', bad #- '{item,slots,0,decision}'),
      ('decision unknown', jsonb_set(bad, '{item,slots,0,decision}', '"delete"')),
      ('decision a number', jsonb_set(bad, '{item,slots,0,decision}', '1')),
      ('text missing', bad #- '{item,slots,0,text}'),
      ('text 301 characters', jsonb_set(bad, '{item,slots,0,text}', to_jsonb(repeat('t', 301)))),
      ('text a number', jsonb_set(bad, '{item,slots,0,text}', '1')),
      ('text null', jsonb_set(bad, '{item,slots,0,text}', 'null')),
      ('good slot then bad slot', jsonb_set(bad, '{item,slots}', jsonb_build_array(slot, slot - 'decision')))
    ) as t(name, args)
  loop
    select count(*) into rows_before from melinda_private.director_answers;
    r := public.melinda_director_answers('set', c.args);
    select count(*) into rows_after from melinda_private.director_answers;
    if r is distinct from invalid then
      raise exception 'set with %: expected invalid_command, got %', c.name, r;
    end if;
    if rows_after is distinct from rows_before then
      raise exception 'set with % wrote rows (% -> %)', c.name, rows_before, rows_after;
    end if;
  end loop;
  if exists (select 1 from melinda_private.director_answers where item_id is distinct from id_a) then
    raise exception 'an invalid set left rows behind';
  end if;
  -- SQL NULL args (not JSON null)
  r := public.melinda_director_answers('set', null);
  if r is distinct from invalid then raise exception 'SQL NULL args accepted by set: %', r; end if;

  -- invalid clear input removes nothing
  for c in
    select * from (values
      ('id missing', '{}'::jsonb),
      ('id null', '{"id":null}'::jsonb),
      ('id 15 hex', '{"id":"0000000000000aa"}'::jsonb),
      ('id uppercase hex', '{"id":"00000000000000AA"}'::jsonb),
      ('id a number', '{"id":1234567890123456}'::jsonb),
      ('args an array', '[]'::jsonb),
      ('args json null', 'null'::jsonb)
    ) as t(name, args)
  loop
    r := public.melinda_director_answers('clear', c.args);
    if r is distinct from invalid then
      raise exception 'clear with %: expected invalid_command, got %', c.name, r;
    end if;
  end loop;
  r := public.melinda_director_answers('clear', null);
  if r is distinct from invalid then raise exception 'SQL NULL args accepted by clear: %', r; end if;
  if not exists (select 1 from melinda_private.director_answers where item_id = id_a) then
    raise exception 'an invalid clear removed a row';
  end if;

  -- list needs an object too
  r := public.melinda_director_answers('list', '[]');
  if r is distinct from invalid then raise exception 'list accepted an array: %', r; end if;
  r := public.melinda_director_answers('list', 'null');
  if r is distinct from invalid then raise exception 'list accepted JSON null: %', r; end if;
  r := public.melinda_director_answers('list', null);
  if r is distinct from invalid then raise exception 'SQL NULL args accepted by list: %', r; end if;

  -- unknown command, and a NULL command
  r := public.melinda_director_answers('bogus', good);
  if r is distinct from invalid then raise exception 'unknown command did not return invalid_command: %', r; end if;
  r := public.melinda_director_answers(null, good);
  if r is distinct from invalid then raise exception 'NULL command did not return invalid_command: %', r; end if;
  r := public.melinda_director_answers('delete', jsonb_build_object('id', id_a));
  if r is distinct from invalid or not exists (select 1 from melinda_private.director_answers where item_id = id_a) then
    raise exception 'a delete command was honored: %', r;
  end if;

  -- list returns at most 2000 rows, applied before the aggregate
  insert into melinda_private.director_answers (item_id, doc_path, line_text, slots, answered_by)
    select lpad(to_hex(g), 16, '0'), 'qa.md', 'l', jsonb_build_array(slot), 'qa' from generate_series(4096, 6096) g;
  r := public.melinda_director_answers('list', '{}');
  if jsonb_array_length(r->'answers') is distinct from 2000 then
    raise exception 'list returned % rows instead of 2000', jsonb_array_length(r->'answers');
  end if;
end $$;
rollback;
