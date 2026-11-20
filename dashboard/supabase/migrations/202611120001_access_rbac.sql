-- Role-based access: named accounts for the Vice Director and department staff, next to the Director's passcode.
-- Adds melinda_private.access_users, access_sessions and access_audit, and public.melinda_access(command, args),
-- a server-only command surface. Arguments and results use camelCase keys. Failures return
-- {"errorCode": "conflict" | "not_found" | "invalid_payload"}. The Director is never an account: the role column
-- rejects DIRECTOR, and the Director keeps using melinda_director (passcode and melinda_private.sessions), unchanged.
-- Commands: login_lookup, session_create, session_read, session_revoke, user_list, user_create, user_update,
-- user_set_disabled, password_set, audit_append, audit_list. A command that changes an account appends to
-- access_audit in the same call when args.actor is present. Hashes and random values come from the server; the
-- database only stores them. It replaces no existing function or table.
-- Apply in the Supabase SQL Editor; the agent has no DB access.
begin;

select melinda_private.record_migration('202611120001', '202611120001_access_rbac');

create table melinda_private.access_users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (length(email) <= 254 and email = lower(email) and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  display_name text not null check (length(display_name) between 1 and 80),
  role text not null check (role in ('VICE_DIRECTOR', 'STAFF_FINANCE', 'STAFF_HR', 'STAFF_OPS', 'STAFF_SUPPORT')),
  password_hash text not null check (length(password_hash) between 1 and 512),
  credential_version text not null check (length(credential_version) between 1 and 128),
  must_change_password boolean not null default true,
  disabled_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);
create table melinda_private.access_sessions (
  token_hash text primary key,
  user_id uuid not null references melinda_private.access_users(id) on delete cascade,
  credential_version text not null,
  expires_at timestamptz not null default (clock_timestamp() + interval '30 minutes')
);
create index access_sessions_user_id_idx on melinda_private.access_sessions (user_id);
create table melinda_private.access_audit (
  id bigint generated always as identity primary key,
  actor text check (length(actor) <= 254),
  action text not null check (action in ('login_ok', 'login_fail', 'logout', 'user_create', 'user_update',
    'user_disable', 'user_enable', 'password_reset', 'password_change')),
  target text check (length(target) <= 254),
  created_at timestamptz not null default clock_timestamp()
);

alter table melinda_private.access_users enable row level security;
alter table melinda_private.access_sessions enable row level security;
alter table melinda_private.access_audit enable row level security;
revoke all on melinda_private.access_users, melinda_private.access_sessions, melinda_private.access_audit
  from public, anon, authenticated, service_role;
revoke all on sequence melinda_private.access_audit_id_seq from public, anon, authenticated, service_role;

create function melinda_private.access_user_json(u melinda_private.access_users)
returns jsonb language sql immutable set search_path = ''
as $$
  select jsonb_build_object('id', u.id, 'email', u.email, 'displayName', u.display_name, 'role', u.role,
    'mustChange', u.must_change_password, 'disabled', u.disabled_at is not null, 'updatedAt', u.updated_at);
$$;
revoke all on function melinda_private.access_user_json(melinda_private.access_users)
  from public, anon, authenticated, service_role;

create function public.melinda_access(command text, args jsonb)
returns jsonb language plpgsql security definer set search_path = ''
set lock_timeout = '1s' set statement_timeout = '5s'
as $$
declare
  invalid constant jsonb := jsonb_build_object('errorCode', 'invalid_payload');
  not_found constant jsonb := jsonb_build_object('errorCode', 'not_found');
  uuid_pattern constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  email_pattern constant text := '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$';
  v_email text;
  v_name text;
  v_role text;
  v_hash text;
  v_version text;
  v_token text;
  v_actor text;
  v_action text;
  v_id uuid;
  v_disabled boolean;
  v_must_change boolean;
  u melinda_private.access_users%rowtype;
  result jsonb;
begin
  if command is null or jsonb_typeof(args) is distinct from 'object' then
    return invalid;
  end if;
  if jsonb_typeof(args->'actor') = 'string' and length(args->>'actor') between 1 and 254 then
    v_actor := args->>'actor';
  end if;

  if command = 'login_lookup' then
    if jsonb_typeof(args->'email') is distinct from 'string' then return invalid; end if;
    v_email := lower(btrim(args->>'email'));
    select * into u from melinda_private.access_users where email = v_email and disabled_at is null;
    if not found then return jsonb_build_object('user', null); end if;
    return jsonb_build_object('user', jsonb_build_object('id', u.id, 'email', u.email, 'displayName', u.display_name,
      'role', u.role, 'passwordHash', u.password_hash, 'credentialVersion', u.credential_version,
      'mustChange', u.must_change_password));

  elsif command = 'session_create' then
    if jsonb_typeof(args->'tokenHash') is distinct from 'string' or length(args->>'tokenHash') not between 1 and 128
      or jsonb_typeof(args->'userId') is distinct from 'string' or args->>'userId' !~ uuid_pattern
      or jsonb_typeof(args->'credentialVersion') is distinct from 'string' or length(args->>'credentialVersion') not between 1 and 128 then
      return invalid;
    end if;
    if not exists (select 1 from melinda_private.access_users where id = (args->>'userId')::uuid and disabled_at is null) then
      return not_found;
    end if;
    delete from melinda_private.access_sessions where expires_at <= clock_timestamp();
    insert into melinda_private.access_sessions (token_hash, user_id, credential_version)
      values (args->>'tokenHash', (args->>'userId')::uuid, args->>'credentialVersion');
    return jsonb_build_object('ok', true);

  elsif command = 'session_read' then
    if jsonb_typeof(args->'tokenHash') is distinct from 'string' then return invalid; end if;
    select jsonb_build_object('userId', a.id, 'email', a.email, 'role', a.role, 'displayName', a.display_name,
        'credentialVersion', a.credential_version, 'mustChange', a.must_change_password)
      into result
      from melinda_private.access_sessions s
      join melinda_private.access_users a on a.id = s.user_id
     where s.token_hash = args->>'tokenHash'
       and s.expires_at > clock_timestamp()
       and a.disabled_at is null
       and s.credential_version = a.credential_version;
    return jsonb_build_object('session', result);

  elsif command = 'session_revoke' then
    if jsonb_typeof(args->'tokenHash') is distinct from 'string' then return invalid; end if;
    delete from melinda_private.access_sessions where token_hash = args->>'tokenHash';
    return jsonb_build_object('ok', true);

  elsif command = 'user_list' then
    select coalesce(jsonb_agg(melinda_private.access_user_json(a) order by a.created_at, a.email), '[]'::jsonb)
      into result from melinda_private.access_users a;
    return jsonb_build_object('users', result);

  elsif command = 'user_create' then
    if jsonb_typeof(args->'email') is distinct from 'string' or jsonb_typeof(args->'displayName') is distinct from 'string'
      or jsonb_typeof(args->'role') is distinct from 'string' or jsonb_typeof(args->'passwordHash') is distinct from 'string'
      or jsonb_typeof(args->'credentialVersion') is distinct from 'string' then
      return invalid;
    end if;
    v_email := lower(btrim(args->>'email'));
    v_name := btrim(args->>'displayName');
    v_hash := args->>'passwordHash';
    v_version := args->>'credentialVersion';
    if length(v_email) > 254 or v_email !~ email_pattern or length(v_name) not between 1 and 80
      or length(v_hash) not between 1 and 512 or length(v_version) not between 1 and 128 then
      return invalid;
    end if;
    -- the role is checked by the table constraint, which rejects DIRECTOR
    insert into melinda_private.access_users (email, display_name, role, password_hash, credential_version)
      values (v_email, v_name, args->>'role', v_hash, v_version)
      on conflict (email) do nothing
      returning * into u;
    if not found then return jsonb_build_object('errorCode', 'conflict'); end if;
    if v_actor is not null then
      insert into melinda_private.access_audit (actor, action, target) values (v_actor, 'user_create', u.email);
    end if;
    return jsonb_build_object('user', melinda_private.access_user_json(u));

  elsif command = 'user_update' then
    if jsonb_typeof(args->'userId') is distinct from 'string' or args->>'userId' !~ uuid_pattern then return invalid; end if;
    if coalesce(jsonb_typeof(args->'displayName'), 'null') not in ('string', 'null')
      or coalesce(jsonb_typeof(args->'role'), 'null') not in ('string', 'null')
      or (jsonb_typeof(args->'displayName') is distinct from 'string' and jsonb_typeof(args->'role') is distinct from 'string') then
      return invalid;
    end if;
    if jsonb_typeof(args->'displayName') = 'string' then
      v_name := btrim(args->>'displayName');
      if length(v_name) not between 1 and 80 then return invalid; end if;
    end if;
    v_version := case when jsonb_typeof(args->'credentialVersion') = 'string' then args->>'credentialVersion'
                      else gen_random_uuid()::text end;
    update melinda_private.access_users
       set display_name = coalesce(v_name, display_name),
           role = coalesce(args->>'role', role),
           credential_version = v_version,
           updated_at = clock_timestamp()
     where id = (args->>'userId')::uuid
     returning * into u;
    if not found then return not_found; end if;
    if v_actor is not null then
      insert into melinda_private.access_audit (actor, action, target) values (v_actor, 'user_update', u.email);
    end if;
    return jsonb_build_object('user', melinda_private.access_user_json(u));

  elsif command = 'user_set_disabled' then
    if jsonb_typeof(args->'userId') is distinct from 'string' or args->>'userId' !~ uuid_pattern
      or jsonb_typeof(args->'disabled') is distinct from 'boolean' then
      return invalid;
    end if;
    v_disabled := (args->>'disabled')::boolean;
    v_version := case when jsonb_typeof(args->'credentialVersion') = 'string' then args->>'credentialVersion'
                      else gen_random_uuid()::text end;
    update melinda_private.access_users
       set disabled_at = case when v_disabled then clock_timestamp() else null end,
           credential_version = v_version,
           updated_at = clock_timestamp()
     where id = (args->>'userId')::uuid
     returning * into u;
    if not found then return not_found; end if;
    if v_actor is not null then
      insert into melinda_private.access_audit (actor, action, target)
        values (v_actor, case when v_disabled then 'user_disable' else 'user_enable' end, u.email);
    end if;
    return jsonb_build_object('user', melinda_private.access_user_json(u));

  elsif command = 'password_set' then
    if jsonb_typeof(args->'userId') is distinct from 'string' or args->>'userId' !~ uuid_pattern
      or jsonb_typeof(args->'passwordHash') is distinct from 'string' or length(args->>'passwordHash') not between 1 and 512
      or jsonb_typeof(args->'credentialVersion') is distinct from 'string' or length(args->>'credentialVersion') not between 1 and 128
      or jsonb_typeof(args->'mustChange') is distinct from 'boolean'
      or not coalesce(args->>'action' = any (array['password_reset', 'password_change']), false) then
      return invalid;
    end if;
    v_must_change := (args->>'mustChange')::boolean;
    update melinda_private.access_users
       set password_hash = args->>'passwordHash',
           credential_version = args->>'credentialVersion',
           must_change_password = v_must_change,
           updated_at = clock_timestamp()
     where id = (args->>'userId')::uuid
     returning * into u;
    if not found then return not_found; end if;
    if v_actor is not null then
      insert into melinda_private.access_audit (actor, action, target) values (v_actor, args->>'action', u.email);
    end if;
    return jsonb_build_object('user', melinda_private.access_user_json(u));

  elsif command = 'audit_append' then
    v_action := args->>'action';
    if v_action is null or jsonb_typeof(args->'action') is distinct from 'string'
      or v_action <> all (array['login_ok', 'login_fail', 'logout', 'user_create', 'user_update', 'user_disable',
        'user_enable', 'password_reset', 'password_change'])
      or coalesce(jsonb_typeof(args->'actor'), 'null') not in ('string', 'null')
      or coalesce(jsonb_typeof(args->'target'), 'null') not in ('string', 'null')
      or length(args->>'actor') > 254 or length(args->>'target') > 254 then
      return invalid;
    end if;
    insert into melinda_private.access_audit (actor, action, target)
      values (args->>'actor', v_action, args->>'target');
    return jsonb_build_object('ok', true);

  elsif command = 'audit_list' then
    select coalesce(jsonb_agg(jsonb_build_object('actor', t.actor, 'action', t.action, 'target', t.target,
        'createdAt', t.created_at) order by t.id desc), '[]'::jsonb)
      into result
      from (select * from melinda_private.access_audit order by id desc limit 100) t;
    return jsonb_build_object('events', result);
  end if;

  return invalid;
end;
$$;

revoke all on function public.melinda_access(text, jsonb) from public, anon, authenticated;
grant execute on function public.melinda_access(text, jsonb) to service_role;

commit;
