-- Dedicated QA only. On a database built from every migration file, the ledger holds one row per file:
-- the backfill must find a trace of each of the 24 migrations that predate the ledger.
do $$
declare
  missing text;
begin
  select string_agg(expected.version, ', ' order by expected.version) into missing
  from unnest(array[
    '202610030001', '202610070001', '202610070002', '202610240001', '202610260001', '202610270001', '202610280001',
    '202610290001', '202610290002', '202610300001', '202611020001', '202611040001', '202611050001', '202611050002',
    '202611060001', '202611070001', '202611080001', '202611080002', '202611080003', '202611090001', '202611090002',
    '202611090003', '202611100001', '202611100002', '202611100003', '202611100004'
  ]) as expected(version)
  where not exists (select 1 from melinda_private.schema_migrations ledger where ledger.version = expected.version);
  if missing is not null then raise exception 'Ledger is missing: %', missing; end if;
  begin
    perform melinda_private.record_migration('202611100004', '202611100004_ledger_backfill');
    raise exception 'A second backfill was not refused';
  exception when others then
    if sqlerrm not like 'migration % is already applied' then raise; end if;
  end;
end $$;
