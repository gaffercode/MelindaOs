-- Schema status: adds public.melinda_schema_status(command, args), a read-only, server-only command
-- surface. The `ledger` command returns {"versions": [...]}, the versions recorded in
-- melinda_private.schema_migrations in ascending order, so the Director dashboard can name migrations
-- that are in the repository but not applied. Any other command returns {"errorCode": "invalid_command"}.
-- It replaces no existing function and changes no table.
-- Apply in the Supabase SQL Editor; the agent has no DB access.
begin;

select melinda_private.record_migration('202611110004', '202611110004_schema_status');

create function public.melinda_schema_status(command text, args jsonb)
returns jsonb language plpgsql stable security definer set search_path = ''
set lock_timeout = '1s' set statement_timeout = '5s'
as $$
declare
  result jsonb;
begin
  if command = 'ledger' then
    select jsonb_agg(m.version order by m.version) into result
      from melinda_private.schema_migrations m;
    return jsonb_build_object('versions', coalesce(result, '[]'::jsonb));
  end if;
  return jsonb_build_object('errorCode', 'invalid_command');
end;
$$;

revoke all on function public.melinda_schema_status(text, jsonb) from public, anon, authenticated;
grant execute on function public.melinda_schema_status(text, jsonb) to service_role;

commit;
