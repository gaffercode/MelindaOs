-- Dedicated QA only. Apply 202611220001_clinical_entries first; every synthetic row rolls back.
begin;
do $$
declare
  r jsonb;
  c record;
  rows_before bigint;
  rows_after bigint;
  first_id uuid;
  fn text := 'public.melinda_clinical(text,jsonb)';
  invalid constant jsonb := '{"errorCode": "invalid_command"}';
  incident constant jsonb := jsonb_build_object(
    'time', '14:05', 'place', 'Aster', 'type', 'KNC', 'grade', 'hijau', 'chronology', 'Obat hampir tertukar.',
    'followUp', '', 'progress', 'baru', 'reporter', 'Ns. QA');
  good constant jsonb := jsonb_build_object('key', 'qa-clinical-0001', 'kind', 'insiden', 'date', '2026-11-22',
    'shift', null, 'unit', 'Rawat inap', 'payload', incident, 'actor', 'qa-director');
begin
  if has_function_privilege('anon', fn, 'EXECUTE')
    or has_function_privilege('authenticated', fn, 'EXECUTE')
    or not has_function_privilege('service_role', fn, 'EXECUTE') then
    raise exception 'RPC privilege boundary failed';
  end if;
  if has_table_privilege('service_role', 'melinda_private.clinical_entries', 'SELECT,INSERT,UPDATE,DELETE')
    or has_table_privilege('anon', 'melinda_private.clinical_entries', 'SELECT')
    or has_table_privilege('authenticated', 'melinda_private.clinical_entries', 'SELECT')
    or has_table_privilege('service_role', 'melinda_private.clinical_reads', 'SELECT,INSERT,UPDATE,DELETE')
    or has_table_privilege('anon', 'melinda_private.clinical_reads', 'SELECT') then
    raise exception 'Clinical tables boundary failed';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'melinda_private.clinical_entries'::regclass)
    or not (select relrowsecurity from pg_class where oid = 'melinda_private.clinical_reads'::regclass) then
    raise exception 'Row level security is not enabled on the clinical tables';
  end if;

  select count(*) into rows_before from melinda_private.clinical_entries;

  -- create is idempotent on the key
  r := public.melinda_clinical('create', good);
  if (r->>'replayed')::boolean is distinct from false or r->>'id' is null then raise exception 'create failed: %', r; end if;
  first_id := (r->>'id')::uuid;
  r := public.melinda_clinical('create', good);
  if (r->>'replayed')::boolean is distinct from true or (r->>'id')::uuid <> first_id then raise exception 'replay failed: %', r; end if;
  select count(*) into rows_after from melinda_private.clinical_entries;
  if rows_after <> rows_before + 1 then raise exception 'create is not idempotent'; end if;

  -- list filters by kind, date range and status, newest first
  r := public.melinda_clinical('list', '{"kind": "insiden", "from": "2026-11-22", "to": "2026-11-22"}');
  if jsonb_array_length(r->'entries') <> 1 or r->'entries'->0->>'unit' <> 'Rawat inap' then raise exception 'list failed: %', r; end if;
  r := public.melinda_clinical('list', '{"kind": "roster"}');
  if jsonb_array_length(r->'entries') <> 0 then raise exception 'list leaked another kind: %', r; end if;

  -- update checks the revision, the kind of a replaced payload and bumps the revision
  r := public.melinda_clinical('update', jsonb_build_object('id', first_id, 'revision', 2, 'actor', 'qa', 'status', 'dibatalkan'));
  if r <> '{"errorCode": "conflict"}' then raise exception 'stale revision was accepted: %', r; end if;
  r := public.melinda_clinical('update', jsonb_build_object('id', first_id, 'revision', 1, 'actor', 'qa', 'kind', 'roster', 'payload', incident));
  if r <> invalid then raise exception 'payload for another kind was accepted: %', r; end if;
  r := public.melinda_clinical('update', jsonb_build_object('id', first_id, 'revision', 1, 'actor', 'qa-doctor', 'status', 'dibatalkan'));
  if r->'entry'->>'status' <> 'dibatalkan' or (r->'entry'->>'revision')::int <> 2 or r->'entry'->>'updatedBy' <> 'qa-doctor' then raise exception 'update failed: %', r; end if;
  r := public.melinda_clinical('list', '{"status": "aktif"}');
  if jsonb_array_length(r->'entries') <> 0 then raise exception 'a cancelled entry is still listed as aktif: %', r; end if;
  r := public.melinda_clinical('update', jsonb_build_object('id', '00000000-0000-4000-8000-000000000000', 'revision', 1, 'actor', 'qa'));
  if r <> '{"errorCode": "not_found"}' then raise exception 'unknown id: %', r; end if;

  -- a handover keeps its shift: clearing it is refused, and the table check backs the RPC
  r := public.melinda_clinical('create', jsonb_build_object('key', 'qa-clinical-0008', 'kind', 'roster', 'date', '2026-11-22',
    'shift', 'pagi', 'unit', 'IGD', 'payload', jsonb_build_object('people', jsonb_build_array(jsonb_build_object('name', 'dr. QA', 'role', 'DPJP')), 'notes', ''), 'actor', 'qa'));
  first_id := (r->>'id')::uuid;
  r := public.melinda_clinical('update', jsonb_build_object('id', first_id, 'revision', 1, 'actor', 'qa', 'shift', null));
  if r <> invalid then raise exception 'a roster lost its shift: %', r; end if;
  begin
    insert into melinda_private.clinical_entries (idempotency_key, kind, entry_date, shift, unit, payload, created_by)
      values ('qa-clinical-0009', 'handover', date '2026-11-22', null, 'IGD', '{}'::jsonb, 'qa');
    raise exception 'the table accepted a handover without a shift';
  exception when check_violation then
    null;
  end;

  -- audit_read appends one row per call
  r := public.melinda_clinical('audit_read', '{"kind": "handover", "reader": "master_token", "count": 3, "detail": {"from": "2026-11-16", "to": "2026-11-22", "limit": 50, "ids": ["a", "b", "c"]}}');
  if r <> '{"ok": true}' or (select count(*) from melinda_private.clinical_reads where reader = 'master_token' and row_count = 3 and detail->>'to' = '2026-11-22' and jsonb_array_length(detail->'ids') = 3) <> 1 then
    raise exception 'audit_read failed: %', r;
  end if;

  -- malformed input is refused without touching the table
  for c in
    select * from (values
      ('create bad kind', 'create', good || '{"kind": "lain"}'::jsonb),
      ('create handover without shift', 'create', good || '{"kind": "handover", "shift": null, "key": "qa-clinical-0006"}'::jsonb),
      ('create date out of range', 'create', good || '{"date": "1999-01-01", "key": "qa-clinical-0007"}'::jsonb),
      ('update huge revision', 'update', jsonb_build_object('id', first_id, 'revision', 99999999999, 'actor', 'qa')),
      ('audit_read detail not object', 'audit_read', '{"kind": "roster", "reader": "x", "count": 1, "detail": []}'::jsonb),
      ('create bad shift', 'create', good || '{"shift": "subuh", "key": "qa-clinical-0002"}'::jsonb),
      ('create bad date', 'create', good || '{"date": "2026-02-30", "key": "qa-clinical-0003"}'::jsonb),
      ('create short key', 'create', good || '{"key": "x"}'::jsonb),
      ('create empty unit', 'create', good || '{"unit": "  ", "key": "qa-clinical-0004"}'::jsonb),
      ('create payload not object', 'create', good || '{"payload": [], "key": "qa-clinical-0005"}'::jsonb),
      ('list bad kind', 'list', '{"kind": "lain"}'::jsonb),
      ('list bad limit', 'list', '{"limit": 201}'::jsonb),
      ('list bad date', 'list', '{"from": "kemarin"}'::jsonb),
      ('update no revision', 'update', jsonb_build_object('id', first_id, 'actor', 'qa')),
      ('audit_read bad kind', 'audit_read', '{"kind": "lain", "reader": "x", "count": 1}'::jsonb),
      ('audit_read negative count', 'audit_read', '{"kind": "roster", "reader": "x", "count": -1}'::jsonb)
    ) as t(label, command, args)
  loop
    r := public.melinda_clinical(c.command, c.args);
    if r <> invalid then raise exception '% was accepted: %', c.label, r; end if;
  end loop;
  r := public.melinda_clinical('bogus', good);
  if r <> invalid then raise exception 'unknown command was accepted: %', r; end if;
  r := public.melinda_clinical(null, good);
  if r <> invalid then raise exception 'null command was accepted: %', r; end if;
  select count(*) into rows_after from melinda_private.clinical_entries;
  if rows_after <> rows_before + 2 then raise exception 'a refused call stored a row'; end if;

  -- the DOCTOR role exists in access_users and DIRECTOR still does not
  begin
    insert into melinda_private.access_users (email, display_name, role, password_hash, credential_version)
      values ('qa-doctor@example.test', 'dr. QA', 'DOCTOR', 'h', 'v');
  exception when check_violation then
    raise exception 'DOCTOR is not an allowed role';
  end;
  begin
    insert into melinda_private.access_users (email, display_name, role, password_hash, credential_version)
      values ('qa-director@example.test', 'Direktur QA', 'DIRECTOR', 'h', 'v');
    raise exception 'DIRECTOR became an allowed account role';
  exception when check_violation then
    null;
  end;
end;
$$;
rollback;
