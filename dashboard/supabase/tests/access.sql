-- Dedicated QA only. Apply 202611120001_access_rbac first; every synthetic row rolls back.
begin;
do $$
declare
  fn text := 'public.melinda_access(text,jsonb)';
  r jsonb;
  hr_id uuid;
  fin_id uuid;
  raised boolean;
  v_audit integer;
begin
  -- privilege and table boundary
  if has_function_privilege('anon', 'public.melinda_access(text, jsonb)', 'execute')
    or has_function_privilege('authenticated', 'public.melinda_access(text, jsonb)', 'execute')
    or not has_function_privilege('service_role', fn, 'execute') then
    raise exception 'RPC privilege boundary failed';
  end if;
  if has_table_privilege('service_role', 'melinda_private.access_users', 'SELECT,INSERT,UPDATE,DELETE')
    or has_table_privilege('service_role', 'melinda_private.access_sessions', 'SELECT,INSERT,UPDATE,DELETE')
    or has_table_privilege('service_role', 'melinda_private.access_audit', 'SELECT,INSERT,UPDATE,DELETE')
    or has_table_privilege('anon', 'melinda_private.access_users', 'SELECT')
    or has_table_privilege('authenticated', 'melinda_private.access_users', 'SELECT') then
    raise exception 'Access table boundary failed';
  end if;
  if exists (select 1 from pg_class where oid in ('melinda_private.access_users'::regclass,
      'melinda_private.access_sessions'::regclass, 'melinda_private.access_audit'::regclass) and not relrowsecurity) then
    raise exception 'Row level security is not enabled on an access table';
  end if;

  -- the role column rejects DIRECTOR
  raised := false;
  begin
    perform public.melinda_access('user_create', jsonb_build_object('email', 'boss@melinda.test', 'displayName', 'Boss',
      'role', 'DIRECTOR', 'passwordHash', 'scrypt$s$h', 'credentialVersion', 'v1', 'actor', 'qa'));
  exception when check_violation then raised := true;
  end;
  if not raised then raise exception 'DIRECTOR role was accepted'; end if;

  -- create, normalise email, reject a duplicate by case
  r := public.melinda_access('user_create', jsonb_build_object('email', '  staff.hr@melinda.test ', 'displayName', 'Staf SDM',
    'role', 'STAFF_HR', 'passwordHash', 'scrypt$s$h', 'credentialVersion', 'v1', 'actor', 'qa-director'));
  if r->'user'->>'email' is distinct from 'staff.hr@melinda.test' or r->'user'->>'role' is distinct from 'STAFF_HR'
    or (r->'user'->>'mustChange')::boolean is not true or (r->'user') ? 'passwordHash' then
    raise exception 'user_create returned an unexpected user: %', r;
  end if;
  hr_id := (r->'user'->>'id')::uuid;
  r := public.melinda_access('user_create', jsonb_build_object('email', 'STAFF.HR@melinda.test', 'displayName', 'Dua',
    'role', 'STAFF_HR', 'passwordHash', 'scrypt$s$h', 'credentialVersion', 'v1', 'actor', 'qa-director'));
  if r->>'errorCode' is distinct from 'conflict' then raise exception 'Duplicate email did not conflict: %', r; end if;
  r := public.melinda_access('user_create', jsonb_build_object('email', 'not-an-email', 'displayName', 'X',
    'role', 'STAFF_HR', 'passwordHash', 'scrypt$s$h', 'credentialVersion', 'v1'));
  if r->>'errorCode' is distinct from 'invalid_payload' then raise exception 'Bad email was not invalid_payload: %', r; end if;
  r := public.melinda_access('user_create', jsonb_build_object('email', 'staff.fin@melinda.test', 'displayName', 'Staf Keuangan',
    'role', 'STAFF_FINANCE', 'passwordHash', 'scrypt$s$h', 'credentialVersion', 'v1', 'actor', 'qa-director'));
  fin_id := (r->'user'->>'id')::uuid;

  -- login lookup, case-insensitive; carries the hash for Node to verify
  r := public.melinda_access('login_lookup', '{"email":" Staff.HR@melinda.test"}');
  if r->'user'->>'id' is distinct from hr_id::text or r->'user'->>'passwordHash' is distinct from 'scrypt$s$h'
    or r->'user'->>'credentialVersion' is distinct from 'v1' or r->'user'->>'displayName' is distinct from 'Staf SDM' then
    raise exception 'login_lookup did not return the account: %', r;
  end if;
  r := public.melinda_access('login_lookup', '{"email":"nobody@melinda.test"}');
  if r->'user' is distinct from 'null'::jsonb then raise exception 'Unknown email returned a user: %', r; end if;

  -- sessions: fresh row reads back
  perform public.melinda_access('session_create', jsonb_build_object('tokenHash', 'qa-tok-1', 'userId', hr_id, 'credentialVersion', 'v1'));
  r := public.melinda_access('session_read', '{"tokenHash":"qa-tok-1"}');
  if r->'session'->>'userId' is distinct from hr_id::text or r->'session'->>'role' is distinct from 'STAFF_HR'
    or r->'session'->>'email' is distinct from 'staff.hr@melinda.test' or r->'session'->>'displayName' is distinct from 'Staf SDM'
    or r->'session'->>'credentialVersion' is distinct from 'v1' or (r->'session'->>'mustChange')::boolean is not true then
    raise exception 'session_read did not return the session: %', r;
  end if;
  r := public.melinda_access('session_read', '{"tokenHash":"unknown"}');
  if r->'session' is distinct from 'null'::jsonb then raise exception 'Unknown token returned a session: %', r; end if;

  -- expired session
  update melinda_private.access_sessions set expires_at = clock_timestamp() - interval '1 minute' where token_hash = 'qa-tok-1';
  r := public.melinda_access('session_read', '{"tokenHash":"qa-tok-1"}');
  if r->'session' is distinct from 'null'::jsonb then raise exception 'Expired session was returned: %', r; end if;

  -- credential_version mismatch
  perform public.melinda_access('session_create', jsonb_build_object('tokenHash', 'qa-tok-2', 'userId', hr_id, 'credentialVersion', 'v1'));
  if public.melinda_access('session_read', '{"tokenHash":"qa-tok-2"}')->'session' = 'null'::jsonb then
    raise exception 'Fresh session was not readable';
  end if;
  update melinda_private.access_sessions set credential_version = 'stale' where token_hash = 'qa-tok-2';
  r := public.melinda_access('session_read', '{"tokenHash":"qa-tok-2"}');
  if r->'session' is distinct from 'null'::jsonb then raise exception 'Mismatched credential_version was returned: %', r; end if;

  -- disabling ends sessions and hides the login
  perform public.melinda_access('session_create', jsonb_build_object('tokenHash', 'qa-tok-3', 'userId', hr_id, 'credentialVersion', 'v1'));
  r := public.melinda_access('user_set_disabled', jsonb_build_object('userId', hr_id, 'disabled', true, 'actor', 'qa-director'));
  if r->>'errorCode' is not null then raise exception 'user_set_disabled failed: %', r; end if;
  r := public.melinda_access('session_read', '{"tokenHash":"qa-tok-3"}');
  if r->'session' is distinct from 'null'::jsonb then raise exception 'Disabled account kept a session: %', r; end if;
  r := public.melinda_access('login_lookup', '{"email":"staff.hr@melinda.test"}');
  if r->'user' is distinct from 'null'::jsonb then raise exception 'Disabled account could look up: %', r; end if;
  -- enabling does not revive the old session (version rotated), but allows login again
  perform public.melinda_access('user_set_disabled', jsonb_build_object('userId', hr_id, 'disabled', false, 'actor', 'qa-director'));
  if public.melinda_access('session_read', '{"tokenHash":"qa-tok-3"}')->'session' is distinct from 'null'::jsonb then
    raise exception 'Old session survived disable and enable';
  end if;
  if public.melinda_access('login_lookup', '{"email":"staff.hr@melinda.test"}')->'user' = 'null'::jsonb then
    raise exception 'Re-enabled account could not look up';
  end if;

  -- user_update rotates credential_version and ends sessions
  perform public.melinda_access('session_create', jsonb_build_object('tokenHash', 'qa-tok-4', 'userId', fin_id, 'credentialVersion', 'v1'));
  r := public.melinda_access('user_update', jsonb_build_object('userId', fin_id, 'displayName', 'Keuangan Baru', 'role', 'STAFF_OPS', 'actor', 'qa-director'));
  if r->'user'->>'role' is distinct from 'STAFF_OPS' or r->'user'->>'displayName' is distinct from 'Keuangan Baru' then
    raise exception 'user_update did not change the account: %', r;
  end if;
  if public.melinda_access('session_read', '{"tokenHash":"qa-tok-4"}')->'session' is distinct from 'null'::jsonb then
    raise exception 'user_update did not end old sessions';
  end if;
  r := public.melinda_access('user_update', jsonb_build_object('userId', gen_random_uuid(), 'displayName', 'Hantu'));
  if r->>'errorCode' is distinct from 'not_found' then raise exception 'Unknown user did not return not_found: %', r; end if;

  -- password_set stores the hash, applies mustChange and rotates the version
  r := public.melinda_access('password_set', jsonb_build_object('userId', fin_id, 'passwordHash', 'scrypt$s2$h2',
    'credentialVersion', 'v9', 'mustChange', false, 'actor', 'qa-director', 'action', 'password_reset'));
  if r->>'errorCode' is not null then raise exception 'password_set failed: %', r; end if;
  r := public.melinda_access('login_lookup', '{"email":"staff.fin@melinda.test"}');
  if r->'user'->>'passwordHash' is distinct from 'scrypt$s2$h2' or r->'user'->>'credentialVersion' is distinct from 'v9'
    or (r->'user'->>'mustChange')::boolean is not false then
    raise exception 'password_set did not apply: %', r;
  end if;
  r := public.melinda_access('password_set', jsonb_build_object('userId', fin_id, 'passwordHash', 'x', 'credentialVersion', 'v10',
    'mustChange', false, 'action', 'drop_table'));
  if r->>'errorCode' is distinct from 'invalid_payload' then raise exception 'Bad audit action accepted: %', r; end if;

  -- session_revoke
  perform public.melinda_access('session_create', jsonb_build_object('tokenHash', 'qa-tok-5', 'userId', fin_id, 'credentialVersion', 'v9'));
  perform public.melinda_access('session_revoke', '{"tokenHash":"qa-tok-5"}');
  if public.melinda_access('session_read', '{"tokenHash":"qa-tok-5"}')->'session' is distinct from 'null'::jsonb then
    raise exception 'session_revoke left the session';
  end if;

  -- user_list has no hash
  r := public.melinda_access('user_list', '{}');
  if jsonb_array_length(r->'users') is distinct from 2 or (r->'users'->0) ? 'passwordHash' or (r->'users'->0) ? 'password_hash'
    or not ((r->'users'->0) ?& array['id', 'email', 'displayName', 'role', 'mustChange', 'disabled', 'updatedAt']) then
    raise exception 'user_list shape is wrong: %', r;
  end if;

  -- audit: every mutation with an actor is recorded; nothing secret is stored
  select count(*) into v_audit from melinda_private.access_audit;
  perform public.melinda_access('audit_append', '{"actor":"staff.hr@melinda.test","action":"login_fail","target":"staff.hr@melinda.test"}');
  if (select count(*) from melinda_private.access_audit) <> v_audit + 1 then raise exception 'audit_append did not write'; end if;
  r := public.melinda_access('audit_list', '{}');
  if r->'events'->0->>'action' is distinct from 'login_fail' or r->'events'->0->>'actor' is distinct from 'staff.hr@melinda.test'
    or not ((r->'events'->0) ?& array['actor', 'action', 'target', 'createdAt']) then
    raise exception 'audit_list shape is wrong: %', r;
  end if;
  if not exists (select 1 from melinda_private.access_audit where action = 'user_create' and target = 'staff.hr@melinda.test' and actor = 'qa-director')
    or not exists (select 1 from melinda_private.access_audit where action = 'user_disable')
    or not exists (select 1 from melinda_private.access_audit where action = 'user_enable')
    or not exists (select 1 from melinda_private.access_audit where action = 'user_update')
    or not exists (select 1 from melinda_private.access_audit where action = 'password_reset') then
    raise exception 'A mutating command did not append its audit event';
  end if;
  r := public.melinda_access('audit_append', '{"actor":"x","action":"nope","target":"y"}');
  if r->>'errorCode' is distinct from 'invalid_payload' then raise exception 'Bad audit action accepted: %', r; end if;
  r := public.melinda_access('no_such_command', '{}');
  if r->>'errorCode' is distinct from 'invalid_payload' then raise exception 'Unknown command accepted: %', r; end if;

  -- the Director session path is untouched
  perform public.melinda_director('session_create', jsonb_build_object('tokenHash', 'qa-dir-tok', 'reviewerId', 'qa-reviewer', 'credentialVersion', 'dv1'));
  r := public.melinda_director('session_read', jsonb_build_object('tokenHash', 'qa-dir-tok', 'credentialVersion', 'dv1'));
  if r->'session'->>'reviewerId' is distinct from 'qa-reviewer' then
    raise exception 'Director session no longer works: %', r;
  end if;
end $$;
rollback;
