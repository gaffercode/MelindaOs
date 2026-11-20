-- Executive Office staff-role routing: Director assistant is Sdr. Nurma.
-- Keep phone numbers and WhatsApp identifiers exclusively in Grokbot's verified contacts.
-- This forward-only migration intentionally does NOT modify migration 202611080002.
begin;

create table melinda_private.executive_recipient_directory (
  recipient_role text primary key,
  recipient_name text not null check (length(recipient_name) between 1 and 120),
  contact_source text not null default 'grokbot' check (contact_source = 'grokbot'),
  updated_at timestamptz not null default clock_timestamp()
);
alter table melinda_private.executive_recipient_directory enable row level security;
revoke all on melinda_private.executive_recipient_directory from public, anon, authenticated, service_role;

insert into melinda_private.executive_recipient_directory(recipient_role, recipient_name, contact_source)
values ('asisten_direktur', 'Sdr. Nurma', 'grokbot');

create function melinda_private.resolve_executive_recipient()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  resolved_name text;
begin
  if new.recipient_role = 'asisten_direktur' then
    select recipient_name into resolved_name
      from melinda_private.executive_recipient_directory
      where recipient_role = new.recipient_role;
    if resolved_name is null then
      raise exception 'Executive assistant is not configured';
    end if;
    new.recipient_name := resolved_name;
  end if;
  return new;
end;
$$;
revoke all on function melinda_private.resolve_executive_recipient() from public, anon, authenticated, service_role;

create trigger executive_outbox_recipient_name
before insert on melinda_private.executive_outbox
for each row execute function melinda_private.resolve_executive_recipient();

-- Bring earlier pending/failed assistant notifications in line with this designation.
-- Sent receipts remain unmodified to preserve history.
update melinda_private.executive_outbox
set recipient_name = 'Sdr. Nurma'
where recipient_role = 'asisten_direktur'
  and state in ('pending', 'failed')
  and recipient_name is distinct from 'Sdr. Nurma';

comment on table melinda_private.executive_recipient_directory is
  'Display-name mapping only. The Grokbot verified contact directory is the exclusive source for WhatsApp numbers.';
commit;
