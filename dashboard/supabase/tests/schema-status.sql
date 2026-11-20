-- Dedicated QA only. Apply 202611110004_schema_status first; the test only reads.
do $$
declare
  result jsonb;
  versions jsonb;
  listed text[];
  sorted text[];
  ledger_rows bigint;
begin
  if has_function_privilege('anon', 'public.melinda_schema_status(text,jsonb)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.melinda_schema_status(text,jsonb)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.melinda_schema_status(text,jsonb)', 'EXECUTE') then
    raise exception 'RPC privilege boundary failed';
  end if;

  result := public.melinda_schema_status('ledger', '{}'::jsonb);
  versions := result->'versions';
  if jsonb_typeof(versions) is distinct from 'array' then
    raise exception 'ledger did not return a versions array: %', result;
  end if;
  if not (versions @> '["202611110004"]'::jsonb) or not (versions @> '["202611100003"]'::jsonb) then
    raise exception 'ledger is missing 202611110004 or 202611100003: %', versions;
  end if;

  select array_agg(v.value order by v.ordinality), array_agg(v.value order by v.value)
    into listed, sorted
    from jsonb_array_elements_text(versions) with ordinality as v(value, ordinality);
  if listed is distinct from sorted then
    raise exception 'ledger versions are not ascending: %', versions;
  end if;

  select count(*) into ledger_rows from melinda_private.schema_migrations;
  if jsonb_array_length(versions) is distinct from ledger_rows then
    raise exception 'ledger returned % versions for % rows', jsonb_array_length(versions), ledger_rows;
  end if;

  result := public.melinda_schema_status('bogus', '{}'::jsonb);
  if result->>'errorCode' is distinct from 'invalid_command' then
    raise exception 'unknown command did not return invalid_command: %', result;
  end if;
end $$;
