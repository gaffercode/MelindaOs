-- Ledger backfill: record the 24 migrations that ran before the ledger existed, but only those
-- this database actually shows a trace of. Run it once, after 202611100003_migration_ledger.
--
-- How it decides: each older migration left something only it (or a later migration that replaced
-- its function) creates: a table, a column, a value in a check constraint, a command in a function
-- body, or the Director's name in the officials row. A trace found means the database carries that
-- change today. No trace means the migration is not recorded, and the last query lists it as
-- "TIDAK ditemukan". Do NOT paste an older migration because of that line: several of them replace
-- a whole function, and running one now would put an old version back. Bring the result table to
-- whoever maintains the code first.
--
-- `applied_at` of a backfilled row is the time of this backfill, not the day the migration ran.
-- Nothing else in the database changes.
begin;

select melinda_private.record_migration('202611100004', '202611100004_ledger_backfill');

create temp table ledger_evidence (version text primary key, name text not null, found boolean not null) on commit drop;

do $$
declare
  director_named boolean := false;
begin
  if to_regclass('melinda_private.officials') is not null then
    execute $q$select exists (select 1 from melinda_private.officials where kelompok = 'direktur' and nama = 'dr. Ferdi Andriska, S.H., M.Kn., CMDC')$q$ into director_named;
  end if;
  insert into ledger_evidence values ('202611020001', '202611020001_officials_director_name', director_named);
end $$;

with
  tables as (select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'melinda_private' and c.relkind = 'r'),
  columns as (select c.relname || '.' || a.attname as name from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'melinda_private' and a.attnum > 0 and not a.attisdropped),
  checks as (select c.relname as table_name, pg_get_constraintdef(con.oid) as definition from pg_constraint con join pg_class c on c.oid = con.conrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'melinda_private' and con.contype = 'c'),
  functions as (select p.proname as name, p.prosrc as body from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public')
insert into ledger_evidence
select version, name, found from (values
  ('202610030001', '202610030001_director', exists (select 1 from tables where name = 'submissions') and exists (select 1 from functions where name = 'melinda_director')),
  ('202610070001', '202610070001_director_instructions', exists (select 1 from tables where name = 'instructions')),
  ('202610070002', '202610070002_director_officials', exists (select 1 from tables where name = 'officials')),
  ('202610240001', '202610240001_daily_documents', exists (select 1 from tables where name = 'daily_documents')),
  ('202610260001', '202610260001_daily_publisher_kinds', exists (select 1 from checks where table_name = 'daily_documents' and definition like '%news_edition%')),
  ('202610270001', '202610270001_medify_snapshot_kind', exists (select 1 from checks where table_name = 'daily_documents' and definition like '%medify_snapshot%')),
  ('202610280001', '202610280001_director_instructions_umum', exists (select 1 from checks where table_name = 'instructions' and definition like '%umum%')),
  ('202610290001', '202610290001_instructions_terkendala_polling', exists (select 1 from checks where table_name = 'instructions' and definition like '%terkendala%')),
  ('202610290002', '202610290002_director_instructions_open', exists (select 1 from functions where name = 'melinda_director_instructions' and body like '%command = ''open''%')),
  ('202610300001', '202610300001_instructions_terkendala_before_delivery', exists (select 1 from functions where name = 'melinda_director_instructions' and body like '%from_status in (''dibuat'',''gagal'') and to_status = ''terkendala''%')),
  ('202611040001', '202611040001_medify_run_status_kind', exists (select 1 from checks where table_name = 'daily_documents' and definition like '%medify_run_status%')),
  ('202611050001', '202611050001_starkes_audit', exists (select 1 from tables where name = 'starkes_ep_scores')),
  ('202611050002', '202611050002_studio_documents', exists (select 1 from tables where name = 'studio_packages')),
  ('202611060001', '202611060001_daily_pipeline', exists (select 1 from tables where name = 'daily_pipeline_runs')),
  ('202611070001', '202611070001_starkes_evidence', exists (select 1 from tables where name = 'starkes_evidence')),
  ('202611080001', '202611080001_director_tasks', exists (select 1 from tables where name = 'schedule_items') and exists (select 1 from functions where name = 'melinda_director_tasks')),
  ('202611080002', '202611080002_executive_office', exists (select 1 from tables where name = 'executive_calendar')),
  ('202611080003', '202611080003_executive_nurma_recipient', exists (select 1 from tables where name = 'executive_recipient_directory')),
  ('202611090001', '202611090001_pharmacy_orders', exists (select 1 from tables where name = 'pharmacy_orders')),
  ('202611090002', '202611090002_pharmacy_order_removal', exists (select 1 from tables where name = 'pharmacy_order_removed')),
  ('202611090003', '202611090003_director_tasks_topic', exists (select 1 from columns where name = 'schedule_items.topic')),
  ('202611100001', '202611100001_agent_gateway', exists (select 1 from tables where name = 'agent_data_records')),
  ('202611100002', '202611100002_melinda_agent', exists (select 1 from tables where name = 'melinda_conversations'))
) as evidence(version, name, found);

insert into melinda_private.schema_migrations (version, name)
select version, name from ledger_evidence where found
on conflict (version) do nothing;

commit;

-- The result the SQL Editor shows: one line per migration file up to this one.
select expected.version,
       coalesce(ledger.name, '') as name,
       case when ledger.version is null then 'TIDAK ditemukan' else 'tercatat' end as status
from unnest(array[
  '202610030001', '202610070001', '202610070002', '202610240001', '202610260001', '202610270001', '202610280001',
  '202610290001', '202610290002', '202610300001', '202611020001', '202611040001', '202611050001', '202611050002',
  '202611060001', '202611070001', '202611080001', '202611080002', '202611080003', '202611090001', '202611090002',
  '202611090003', '202611100001', '202611100002', '202611100003', '202611100004'
]) as expected(version)
left join melinda_private.schema_migrations ledger using (version)
order by expected.version;
