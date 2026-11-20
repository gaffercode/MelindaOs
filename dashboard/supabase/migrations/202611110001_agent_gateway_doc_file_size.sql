-- LUNA doc_store 10 MiB: raise the durable payload cap for doc.file rows only.
-- The 202611100001_agent_gateway intake check (octet_length(payload::text) <= 40000)
-- rejects a 10 MiB file as base64 (~13.98 MiB). doc.file rows carry one base64
-- file plus small metadata, so they get a 15 MiB cap; every other kind keeps
-- the 40 KB cap. Apply in the Supabase SQL Editor; the agent has no DB access.
begin;

select melinda_private.record_migration('202611110001', '202611110001_agent_gateway_doc_file_size');

alter table melinda_private.agent_data_records
  drop constraint if exists agent_data_records_payload_check;

alter table melinda_private.agent_data_records
  add constraint agent_data_records_payload_size_check check (
    octet_length(payload::text) <= 40000
    or (kind = 'doc.file' and octet_length(payload::text) <= 15728640)
  );

commit;
