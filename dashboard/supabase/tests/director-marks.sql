-- Dedicated QA only. Apply 202611110005_director_marks first; every synthetic row rolls back.
begin;
do $$
declare
  r jsonb;
  c record;
  rows_before bigint;
  rows_after bigint;
  first_at timestamptz;
  second_at timestamptz;
  fn text := 'public.melinda_director_marks(text,jsonb)';
begin
  -- privilege and table boundary
  if has_function_privilege('anon', fn, 'EXECUTE')
    or has_function_privilege('authenticated', fn, 'EXECUTE')
    or not has_function_privilege('service_role', fn, 'EXECUTE') then
    raise exception 'RPC privilege boundary failed';
  end if;
  if has_table_privilege('service_role', 'melinda_private.director_marks', 'SELECT,INSERT,UPDATE,DELETE')
    or has_table_privilege('anon', 'melinda_private.director_marks', 'SELECT')
    or has_table_privilege('authenticated', 'melinda_private.director_marks', 'SELECT') then
    raise exception 'Marks table boundary failed';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'melinda_private.director_marks'::regclass) then
    raise exception 'Row level security is not enabled on director_marks';
  end if;

  -- set two reply marks, list them back
  r := public.melinda_director_marks('set', jsonb_build_object('scope', 'task_reply_read', 'reviewer', 'qa-reviewer',
    'items', jsonb_build_array(jsonb_build_object('key', 'qa-reply-1', 'value', 'read'),
                               jsonb_build_object('key', 'qa-reply-2', 'value', 'read'))));
  if r is distinct from '{"saved": 2}'::jsonb then raise exception 'set did not save 2: %', r; end if;
  r := public.melinda_director_marks('list', '{"scope":"task_reply_read"}');
  if jsonb_typeof(r->'marks') is distinct from 'array' or jsonb_array_length(r->'marks') is distinct from 2
    or not (r->'marks' @> '[{"key":"qa-reply-1","value":"read"},{"key":"qa-reply-2","value":"read"}]'::jsonb) then
    raise exception 'list did not return both reply marks: %', r;
  end if;
  if exists (select 1 from jsonb_array_elements(r->'marks') e where (select count(*) from jsonb_object_keys(e)) is distinct from 2) then
    raise exception 'list items carry keys other than key and value: %', r;
  end if;
  if (select count(*) from melinda_private.director_marks where updated_by is distinct from 'qa-reviewer') > 0 then
    raise exception 'updated_by was not stored';
  end if;

  -- a second set of one key changes its value, keeps one row, moves updated_at forward
  select updated_at into first_at from melinda_private.director_marks where scope = 'task_reply_read' and mark_key = 'qa-reply-1';
  r := public.melinda_director_marks('set', jsonb_build_object('scope', 'task_reply_read', 'reviewer', 'qa-reviewer-2',
    'items', jsonb_build_array(jsonb_build_object('key', 'qa-reply-1', 'value', 'seen'))));
  if r is distinct from '{"saved": 1}'::jsonb then raise exception 'second set did not save 1: %', r; end if;
  select updated_at into second_at from melinda_private.director_marks where scope = 'task_reply_read' and mark_key = 'qa-reply-1';
  if (select count(*) from melinda_private.director_marks where scope = 'task_reply_read' and mark_key = 'qa-reply-1') is distinct from 1
    or (select value from melinda_private.director_marks where scope = 'task_reply_read' and mark_key = 'qa-reply-1') is distinct from 'seen'
    or (select updated_by from melinda_private.director_marks where scope = 'task_reply_read' and mark_key = 'qa-reply-1') is distinct from 'qa-reviewer-2'
    or second_at is not distinct from first_at or second_at < first_at then
    raise exception 'second set did not update in place (% -> %)', first_at, second_at;
  end if;
  -- newest first: qa-reply-1 was touched last
  r := public.melinda_director_marks('list', '{"scope":"task_reply_read"}');
  if r->'marks'->0->>'key' is distinct from 'qa-reply-1' or r->'marks'->0->>'value' is distinct from 'seen' then
    raise exception 'list is not newest first: %', r;
  end if;

  -- duplicate keys in one call: the last value wins, one row, saved counts items received
  r := public.melinda_director_marks('set', jsonb_build_object('scope', 'task_reply_read', 'reviewer', 'qa-reviewer',
    'items', jsonb_build_array(jsonb_build_object('key', 'qa-dup', 'value', 'first'),
                               jsonb_build_object('key', 'qa-other', 'value', 'read'),
                               jsonb_build_object('key', 'qa-dup', 'value', 'last'))));
  if r is distinct from '{"saved": 3}'::jsonb then raise exception 'duplicate-key set did not report 3: %', r; end if;
  if (select count(*) from melinda_private.director_marks where scope = 'task_reply_read' and mark_key = 'qa-dup') is distinct from 1
    or (select value from melinda_private.director_marks where scope = 'task_reply_read' and mark_key = 'qa-dup') is distinct from 'last' then
    raise exception 'duplicate keys in one call did not keep the last value';
  end if;

  -- email_handling with a date prefix
  r := public.melinda_director_marks('set', jsonb_build_object('scope', 'email_handling', 'reviewer', 'qa-reviewer',
    'items', jsonb_build_array(jsonb_build_object('key', '2026-11-11:hai@melinda.co.id', 'value', 'belum'),
                               jsonb_build_object('key', '2026-11-12:hai@melinda.co.id', 'value', 'destri'))));
  if r is distinct from '{"saved": 2}'::jsonb then raise exception 'email set did not save 2: %', r; end if;
  r := public.melinda_director_marks('list', '{"scope":"email_handling","prefix":"2026-11-11:"}');
  if jsonb_array_length(r->'marks') is distinct from 1
    or r->'marks'->0 is distinct from '{"key":"2026-11-11:hai@melinda.co.id","value":"belum"}'::jsonb then
    raise exception 'date prefix did not select one mark: %', r;
  end if;
  -- prefix absent or null means no filter
  r := public.melinda_director_marks('list', '{"scope":"email_handling"}');
  if jsonb_array_length(r->'marks') is distinct from 2 then raise exception 'missing prefix filtered: %', r; end if;
  r := public.melinda_director_marks('list', '{"scope":"email_handling","prefix":null}');
  if jsonb_array_length(r->'marks') is distinct from 2 then raise exception 'null prefix filtered: %', r; end if;
  -- nothing matches: an empty array, not null
  r := public.melinda_director_marks('list', '{"scope":"email_handling","prefix":"2000-01-01:"}');
  if r is distinct from '{"marks": []}'::jsonb then raise exception 'empty list is not an empty array: %', r; end if;

  -- % _ and \ in a prefix match literally
  perform public.melinda_director_marks('set', jsonb_build_object('scope', 'email_handling', 'reviewer', 'qa-reviewer',
    'items', jsonb_build_array(jsonb_build_object('key', 'qa-a%b', 'value', 'belum'),
                               jsonb_build_object('key', 'qa-axb', 'value', 'belum'),
                               jsonb_build_object('key', 'qa-c_d', 'value', 'belum'),
                               jsonb_build_object('key', 'qa-cxd', 'value', 'belum'),
                               jsonb_build_object('key', 'qa-e\f', 'value', 'belum'),
                               jsonb_build_object('key', 'qa-eef', 'value', 'belum'))));
  r := public.melinda_director_marks('list', '{"scope":"email_handling","prefix":"qa-a%"}');
  if jsonb_array_length(r->'marks') is distinct from 1 or r->'marks'->0->>'key' is distinct from 'qa-a%b' then
    raise exception 'percent prefix did not match literally: %', r;
  end if;
  r := public.melinda_director_marks('list', '{"scope":"email_handling","prefix":"qa-c_"}');
  if jsonb_array_length(r->'marks') is distinct from 1 or r->'marks'->0->>'key' is distinct from 'qa-c_d' then
    raise exception 'underscore prefix did not match literally: %', r;
  end if;
  r := public.melinda_director_marks('list', jsonb_build_object('scope', 'email_handling', 'prefix', 'qa-e\'));
  if jsonb_array_length(r->'marks') is distinct from 1 or r->'marks'->0->>'key' is distinct from 'qa-e\f' then
    raise exception 'backslash prefix did not match literally: %', r;
  end if;

  -- scopes never leak into each other
  perform public.melinda_director_marks('set', jsonb_build_object('scope', 'task_reply_read', 'reviewer', 'qa-reviewer',
    'items', jsonb_build_array(jsonb_build_object('key', 'qa-shared-key', 'value', 'read'))));
  perform public.melinda_director_marks('set', jsonb_build_object('scope', 'email_handling', 'reviewer', 'qa-reviewer',
    'items', jsonb_build_array(jsonb_build_object('key', 'qa-shared-key', 'value', 'eskalasi'))));
  r := public.melinda_director_marks('list', '{"scope":"task_reply_read","prefix":"qa-shared"}');
  if jsonb_array_length(r->'marks') is distinct from 1 or r->'marks'->0->>'value' is distinct from 'read' then
    raise exception 'task_reply_read list saw another scope: %', r;
  end if;
  r := public.melinda_director_marks('list', '{"scope":"email_handling","prefix":"qa-shared"}');
  if jsonb_array_length(r->'marks') is distinct from 1 or r->'marks'->0->>'value' is distinct from 'eskalasi' then
    raise exception 'email_handling list saw another scope: %', r;
  end if;
  if exists (select 1 from jsonb_array_elements(public.melinda_director_marks('list', '{"scope":"task_reply_read"}')->'marks') e
             where e->>'key' like '2026-11-%') then
    raise exception 'task_reply_read list returned email_handling rows';
  end if;

  -- boundary values are accepted: 160-character key, 20-character value, 80-character reviewer, 200 items
  r := public.melinda_director_marks('set', jsonb_build_object('scope', 'task_reply_read', 'reviewer', repeat('r', 80),
    'items', jsonb_build_array(jsonb_build_object('key', repeat('k', 160), 'value', repeat('v', 20)))));
  if r is distinct from '{"saved": 1}'::jsonb then raise exception 'boundary lengths refused: %', r; end if;
  r := public.melinda_director_marks('set', jsonb_build_object('scope', 'task_reply_read', 'reviewer', 'qa-reviewer',
    'items', (select jsonb_agg(jsonb_build_object('key', 'qa-bulk-' || g, 'value', 'read')) from generate_series(1, 200) g)));
  if r is distinct from '{"saved": 200}'::jsonb then raise exception '200 items refused: %', r; end if;

  -- every invalid set returns invalid_command and leaves the row count unchanged
  for c in
    select * from (values
      ('unknown scope', jsonb_build_object('scope', 'bogus', 'reviewer', 'qa', 'items', jsonb_build_array(jsonb_build_object('key', 'k', 'value', 'read')))),
      ('scope missing', jsonb_build_object('reviewer', 'qa', 'items', jsonb_build_array(jsonb_build_object('key', 'k', 'value', 'read')))),
      ('scope null', jsonb_build_object('scope', null, 'reviewer', 'qa', 'items', jsonb_build_array(jsonb_build_object('key', 'k', 'value', 'read')))),
      ('scope not a string', jsonb_build_object('scope', 7, 'reviewer', 'qa', 'items', jsonb_build_array(jsonb_build_object('key', 'k', 'value', 'read')))),
      ('reviewer missing', jsonb_build_object('scope', 'task_reply_read', 'items', jsonb_build_array(jsonb_build_object('key', 'k', 'value', 'read')))),
      ('reviewer null', jsonb_build_object('scope', 'task_reply_read', 'reviewer', null, 'items', jsonb_build_array(jsonb_build_object('key', 'k', 'value', 'read')))),
      ('reviewer empty', jsonb_build_object('scope', 'task_reply_read', 'reviewer', '', 'items', jsonb_build_array(jsonb_build_object('key', 'k', 'value', 'read')))),
      ('reviewer 81 characters', jsonb_build_object('scope', 'task_reply_read', 'reviewer', repeat('r', 81), 'items', jsonb_build_array(jsonb_build_object('key', 'k', 'value', 'read')))),
      ('reviewer not a string', jsonb_build_object('scope', 'task_reply_read', 'reviewer', 5, 'items', jsonb_build_array(jsonb_build_object('key', 'k', 'value', 'read')))),
      ('items missing', jsonb_build_object('scope', 'task_reply_read', 'reviewer', 'qa')),
      ('items null', jsonb_build_object('scope', 'task_reply_read', 'reviewer', 'qa', 'items', null)),
      ('items an object', jsonb_build_object('scope', 'task_reply_read', 'reviewer', 'qa', 'items', jsonb_build_object('key', 'k', 'value', 'read'))),
      ('items a string', jsonb_build_object('scope', 'task_reply_read', 'reviewer', 'qa', 'items', 'abc')),
      ('items empty', jsonb_build_object('scope', 'task_reply_read', 'reviewer', 'qa', 'items', '[]'::jsonb)),
      ('items 201', jsonb_build_object('scope', 'task_reply_read', 'reviewer', 'qa',
        'items', (select jsonb_agg(jsonb_build_object('key', 'qa-over-' || g, 'value', 'read')) from generate_series(1, 201) g))),
      ('item key empty', jsonb_build_object('scope', 'task_reply_read', 'reviewer', 'qa', 'items', jsonb_build_array(jsonb_build_object('key', '', 'value', 'read')))),
      ('item key 161 characters', jsonb_build_object('scope', 'task_reply_read', 'reviewer', 'qa', 'items', jsonb_build_array(jsonb_build_object('key', repeat('k', 161), 'value', 'read')))),
      ('item key missing', jsonb_build_object('scope', 'task_reply_read', 'reviewer', 'qa', 'items', jsonb_build_array(jsonb_build_object('value', 'read')))),
      ('item key a number', jsonb_build_object('scope', 'task_reply_read', 'reviewer', 'qa', 'items', jsonb_build_array(jsonb_build_object('key', 12, 'value', 'read')))),
      ('item key null', jsonb_build_object('scope', 'task_reply_read', 'reviewer', 'qa', 'items', jsonb_build_array(jsonb_build_object('key', null, 'value', 'read')))),
      ('item value empty', jsonb_build_object('scope', 'task_reply_read', 'reviewer', 'qa', 'items', jsonb_build_array(jsonb_build_object('key', 'k', 'value', '')))),
      ('item value 21 characters', jsonb_build_object('scope', 'task_reply_read', 'reviewer', 'qa', 'items', jsonb_build_array(jsonb_build_object('key', 'k', 'value', repeat('v', 21))))),
      ('item value missing', jsonb_build_object('scope', 'task_reply_read', 'reviewer', 'qa', 'items', jsonb_build_array(jsonb_build_object('key', 'k')))),
      ('item value a number', jsonb_build_object('scope', 'task_reply_read', 'reviewer', 'qa', 'items', jsonb_build_array(jsonb_build_object('key', 'k', 'value', 1)))),
      ('item value null', jsonb_build_object('scope', 'task_reply_read', 'reviewer', 'qa', 'items', jsonb_build_array(jsonb_build_object('key', 'k', 'value', null)))),
      ('item a string', jsonb_build_object('scope', 'task_reply_read', 'reviewer', 'qa', 'items', jsonb_build_array('qa-key'))),
      ('item an array', jsonb_build_object('scope', 'task_reply_read', 'reviewer', 'qa', 'items', jsonb_build_array(jsonb_build_array('k', 'read')))),
      ('item null', jsonb_build_object('scope', 'task_reply_read', 'reviewer', 'qa', 'items', jsonb_build_array(null))),
      ('good item then bad item', jsonb_build_object('scope', 'task_reply_read', 'reviewer', 'qa', 'items',
        jsonb_build_array(jsonb_build_object('key', 'qa-must-not-exist', 'value', 'read'), jsonb_build_object('key', '', 'value', 'read')))),
      ('args an array', '[]'::jsonb),
      ('args a string', '"set"'::jsonb),
      ('args json null', 'null'::jsonb)
    ) as t(name, args)
  loop
    select count(*) into rows_before from melinda_private.director_marks;
    r := public.melinda_director_marks('set', c.args);
    select count(*) into rows_after from melinda_private.director_marks;
    if r is distinct from '{"errorCode": "invalid_command"}'::jsonb then
      raise exception 'set with %: expected invalid_command, got %', c.name, r;
    end if;
    if rows_after is distinct from rows_before then
      raise exception 'set with % wrote rows (% -> %)', c.name, rows_before, rows_after;
    end if;
  end loop;
  if exists (select 1 from melinda_private.director_marks where mark_key = 'qa-must-not-exist' or mark_key like 'qa-over-%') then
    raise exception 'an invalid set left rows behind';
  end if;
  -- SQL NULL args (not JSON null)
  r := public.melinda_director_marks('set', null);
  if r is distinct from '{"errorCode": "invalid_command"}'::jsonb then raise exception 'SQL NULL args accepted by set: %', r; end if;

  -- invalid list input
  for c in
    select * from (values
      ('unknown scope', '{"scope":"bogus"}'::jsonb),
      ('scope missing', '{}'::jsonb),
      ('scope null', '{"scope":null}'::jsonb),
      ('prefix a number', '{"scope":"email_handling","prefix":5}'::jsonb),
      ('args json null', 'null'::jsonb)
    ) as t(name, args)
  loop
    r := public.melinda_director_marks('list', c.args);
    if r is distinct from '{"errorCode": "invalid_command"}'::jsonb then
      raise exception 'list with %: expected invalid_command, got %', c.name, r;
    end if;
  end loop;
  r := public.melinda_director_marks('list', null);
  if r is distinct from '{"errorCode": "invalid_command"}'::jsonb then raise exception 'SQL NULL args accepted by list: %', r; end if;

  -- unknown command, and a NULL command
  r := public.melinda_director_marks('bogus', '{"scope":"task_reply_read"}');
  if r is distinct from '{"errorCode": "invalid_command"}'::jsonb then raise exception 'unknown command did not return invalid_command: %', r; end if;
  r := public.melinda_director_marks(null, '{"scope":"task_reply_read"}');
  if r is distinct from '{"errorCode": "invalid_command"}'::jsonb then raise exception 'NULL command did not return invalid_command: %', r; end if;
  r := public.melinda_director_marks('delete', '{"scope":"task_reply_read","reviewer":"qa","items":[{"key":"qa-reply-2","value":"read"}]}');
  if r is distinct from '{"errorCode": "invalid_command"}'::jsonb
    or not exists (select 1 from melinda_private.director_marks where scope = 'task_reply_read' and mark_key = 'qa-reply-2') then
    raise exception 'a delete command was honored: %', r;
  end if;

  -- list returns at most 1000 marks, applied before the aggregate
  insert into melinda_private.director_marks (scope, mark_key, value, updated_by)
    select 'email_handling', '2098-01-01:box-' || lpad(g::text, 5, '0'), 'belum', 'qa' from generate_series(1, 1001) g;
  r := public.melinda_director_marks('list', '{"scope":"email_handling","prefix":"2098-01-01:"}');
  if jsonb_array_length(r->'marks') is distinct from 1000 then
    raise exception 'list returned % marks instead of 1000', jsonb_array_length(r->'marks');
  end if;
end $$;
rollback;
