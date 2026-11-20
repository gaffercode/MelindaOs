-- Free-form Director instructions (section 'umum') from the /arahan register page.
-- Apply in the Supabase SQL Editor before deploying the dashboard build that offers "Arahan baru";
-- until then that form fails with HTTP 503 and nothing else changes.
begin;
alter table melinda_private.instructions drop constraint instructions_section_check;
alter table melinda_private.instructions add constraint instructions_section_check
  check (section in ('priorities','followUps','decisions','umum'));
commit;
