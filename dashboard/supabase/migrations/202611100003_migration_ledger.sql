-- Migration ledger: one row per migration applied to this database, so "has it run?" is a query
-- instead of a guess from HANDOFF.md.
--
-- Read it in the SQL Editor:
--   select version, name, applied_at from melinda_private.schema_migrations order by version;
--
-- Every migration after this one starts, inside its own transaction, with:
--   select melinda_private.record_migration('<12-digit version>', '<file name without .sql>');
-- The call fails when that version is already recorded, so pasting a migration twice stops
-- before it can replace newer functions with older ones.
--
-- Migrations before this one are not recorded: this file cannot know which of them ran here.
begin;

create table melinda_private.schema_migrations (
  version text primary key check (version ~ '^[0-9]{12}$'),
  name text not null check (length(name) between 1 and 120),
  applied_at timestamptz not null default clock_timestamp()
);
alter table melinda_private.schema_migrations enable row level security;
revoke all on melinda_private.schema_migrations from public, anon, authenticated, service_role;

create function melinda_private.record_migration(p_version text, p_name text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from melinda_private.schema_migrations where version = p_version) then
    raise exception 'migration % is already applied', p_version;
  end if;
  insert into melinda_private.schema_migrations (version, name) values (p_version, p_name);
end;
$$;
revoke all on function melinda_private.record_migration(text, text) from public, anon, authenticated, service_role;

select melinda_private.record_migration('202611100003', '202611100003_migration_ledger');

commit;
