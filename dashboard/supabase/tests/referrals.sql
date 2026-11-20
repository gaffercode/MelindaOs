-- Dedicated QA only. Apply 202611160001_referrals first; every synthetic row rolls back.
begin;
do $$
declare
  r jsonb;
  c record;
  rows_before bigint;
  rows_after bigint;
  first_ref text;
  first_id uuid;
  fn text := 'public.melinda_referrals(text,jsonb)';
  invalid constant jsonb := '{"errorCode": "invalid_command"}';
  payload constant jsonb := jsonb_build_object(
    'patient', jsonb_build_object('name', 'Pasien QA', 'birthDate', '1992-03-04', 'age', '', 'sex', 'P', 'rm', '', 'nik', ''),
    'referrer', jsonb_build_object('facilityType', 'Klinik', 'facility', 'Klinik QA', 'city', 'Kediri', 'doctor', 'dr. QA', 'phone', '081234567890', 'sip', ''),
    'clinical', jsonb_build_object(
      'profileId', 'hipertensi_dewasa', 'diagnosis', 'Hipertensi', 'reason', 'Kontrol tekanan darah', 'onset', '3 hari',
      'vitals', jsonb_build_object('td', '160/100'), 'checks', '{}'::jsonb, 'therapy', '', 'allergy', '',
      'pregnancy', '', 'insurer', 'BPJS Kesehatan', 'destination', 'Poli Penyakit Dalam', 'date', '2026-11-16', 'time', '09:30', 'notes', ''),
    'consent', true);
  good constant jsonb := jsonb_build_object('key', 'qa-referral-0001', 'payload', payload);
begin
  if has_function_privilege('anon', fn, 'EXECUTE')
    or has_function_privilege('authenticated', fn, 'EXECUTE')
    or not has_function_privilege('service_role', fn, 'EXECUTE') then
    raise exception 'RPC privilege boundary failed';
  end if;
  if has_table_privilege('service_role', 'melinda_private.referrals', 'SELECT,INSERT,UPDATE,DELETE')
    or has_table_privilege('anon', 'melinda_private.referrals', 'SELECT')
    or has_table_privilege('authenticated', 'melinda_private.referrals', 'SELECT') then
    raise exception 'Referrals table boundary failed';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'melinda_private.referrals'::regclass) then
    raise exception 'Row level security is not enabled on referrals';
  end if;

  r := public.melinda_referrals('list', '{}');
  if r is distinct from '{"referrals": []}'::jsonb then raise exception 'empty list is not an empty array: %', r; end if;

  r := public.melinda_referrals('submit', good);
  if (r->>'replayed')::boolean is not false or r->>'reference' !~ '^RJ-[0-9]{8}-[A-F0-9]{8}$' then
    raise exception 'submit did not return a fresh reference: %', r;
  end if;
  first_ref := r->>'reference';
  select id into first_id from melinda_private.referrals where reference = first_ref;
  if first_id is null or (select count(*) from melinda_private.referrals) is distinct from 1 then
    raise exception 'submit did not store exactly one row';
  end if;

  -- the same key is a replay: same reference, no second row
  r := public.melinda_referrals('submit', good);
  if (r->>'replayed')::boolean is not true or r->>'reference' is distinct from first_ref then
    raise exception 'replay did not return the first reference: %', r;
  end if;
  if (select count(*) from melinda_private.referrals) is distinct from 1 then
    raise exception 'replay stored a second row';
  end if;

  -- list carries exactly the eight keys the dashboard reads
  r := public.melinda_referrals('list', '{}');
  if jsonb_array_length(r->'referrals') is distinct from 1 then raise exception 'list did not return the row: %', r; end if;
  if (select array_agg(k order by k) from jsonb_object_keys(r->'referrals'->0) k)
     is distinct from array['handledAt', 'handledBy', 'id', 'note', 'payload', 'receivedAt', 'reference', 'status'] then
    raise exception 'list row does not carry the eight keys: %', r;
  end if;
  if r->'referrals'->0->'payload' is distinct from payload then raise exception 'stored payload changed'; end if;

  -- update moves status, note and handler in one row
  r := public.melinda_referrals('update', jsonb_build_object('id', first_id, 'status', 'diterima', 'actor', 'qa-director', 'note', 'Pasien datang'));
  if r->'referral'->>'status' is distinct from 'diterima'
    or r->'referral'->>'handledBy' is distinct from 'qa-director'
    or r->'referral'->>'note' is distinct from 'Pasien datang'
    or r->'referral'->>'handledAt' is null then
    raise exception 'update did not store the change: %', r;
  end if;
  r := public.melinda_referrals('list', '{"status": "diterima", "limit": 1}');
  if jsonb_array_length(r->'referrals') is distinct from 1 then raise exception 'status filter lost the row: %', r; end if;
  r := public.melinda_referrals('list', '{"status": "baru"}');
  if jsonb_array_length(r->'referrals') is distinct from 0 then raise exception 'status filter kept the wrong row: %', r; end if;

  -- unknown id is a value, not an exception
  r := public.melinda_referrals('update', jsonb_build_object('id', '00000000-0000-4000-8000-000000000000', 'status', 'baru', 'actor', 'qa'));
  if r is distinct from '{"errorCode": "not_found"}'::jsonb then raise exception 'unknown id did not return not_found: %', r; end if;

  -- invalid submit leaves the row count unchanged
  for c in
    select * from (values
      ('args an array', '[]'::jsonb),
      ('args json null', 'null'::jsonb),
      ('key missing', good - 'key'),
      ('key short', jsonb_set(good, '{key}', '"short"')),
      ('key bad characters', jsonb_set(good, '{key}', '"has space here"')),
      ('payload missing', good - 'payload'),
      ('payload an array', jsonb_set(good, '{payload}', '[]')),
      ('consent false', jsonb_set(good, '{payload,consent}', 'false')),
      ('consent missing', good #- '{payload,consent}'),
      ('name empty', jsonb_set(good, '{payload,patient,name}', '""')),
      ('facility empty', jsonb_set(good, '{payload,referrer,facility}', '""')),
      ('payload too large', jsonb_set(good, '{payload,clinical,notes}', to_jsonb(repeat('x', 40000)))),
      ('patient not an object', jsonb_set(good, '{payload,patient}', '[]'))
    ) as t(name, args)
  loop
    select count(*) into rows_before from melinda_private.referrals;
    r := public.melinda_referrals('submit', c.args);
    select count(*) into rows_after from melinda_private.referrals;
    if r is distinct from invalid then raise exception 'submit with %: expected invalid_command, got %', c.name, r; end if;
    if rows_after is distinct from rows_before then raise exception 'submit with % wrote a row', c.name; end if;
  end loop;

  -- invalid update and list inputs
  for c in
    select * from (values
      ('id not a uuid', jsonb_build_object('id', 'abc', 'status', 'baru', 'actor', 'qa')),
      ('status unknown', jsonb_build_object('id', first_id, 'status', 'hilang', 'actor', 'qa')),
      ('actor empty', jsonb_build_object('id', first_id, 'status', 'baru', 'actor', '')),
      ('actor 81', jsonb_build_object('id', first_id, 'status', 'baru', 'actor', repeat('a', 81))),
      ('note 1001', jsonb_build_object('id', first_id, 'status', 'baru', 'actor', 'qa', 'note', repeat('n', 1001))),
      ('note not a string', jsonb_build_object('id', first_id, 'status', 'baru', 'actor', 'qa', 'note', 5)),
      ('id missing', jsonb_build_object('status', 'baru', 'actor', 'qa'))
    ) as t(name, args)
  loop
    r := public.melinda_referrals('update', c.args);
    if r is distinct from invalid then raise exception 'update with %: expected invalid_command, got %', c.name, r; end if;
  end loop;

  for c in
    select * from (values
      ('limit 0', '{"limit": 0}'::jsonb),
      ('limit 101', '{"limit": 101}'::jsonb),
      ('limit a string', '{"limit": "5"}'::jsonb),
      ('limit fractional', '{"limit": 1.5}'::jsonb),
      ('status unknown', '{"status": "hilang"}'::jsonb),
      ('status null', '{"status": null}'::jsonb),
      ('args an array', '[]'::jsonb)
    ) as t(name, args)
  loop
    r := public.melinda_referrals('list', c.args);
    if r is distinct from invalid then raise exception 'list with %: expected invalid_command, got %', c.name, r; end if;
  end loop;

  r := public.melinda_referrals('bogus', good);
  if r is distinct from invalid then raise exception 'unknown command was honored: %', r; end if;
  r := public.melinda_referrals(null, good);
  if r is distinct from invalid then raise exception 'NULL command was honored: %', r; end if;
  if (select count(*) from melinda_private.referrals) is distinct from 1 then
    raise exception 'an invalid call changed the row count';
  end if;
end $$;
rollback;
