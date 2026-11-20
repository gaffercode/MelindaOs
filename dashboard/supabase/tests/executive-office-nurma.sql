-- Synthetic checks for Nurma's assistant routing; all writes roll back.
begin;
do $$
declare
  meeting text := 'qa-executive-nurma';
  first_at timestamptz := clock_timestamp() + interval '1 hour';
  event jsonb;
  response jsonb;
  receipt jsonb;
begin
  if has_table_privilege('anon','melinda_private.executive_recipient_directory','SELECT')
    or has_table_privilege('authenticated','melinda_private.executive_recipient_directory','SELECT')
    or has_table_privilege('service_role','melinda_private.executive_recipient_directory','SELECT') then
    raise exception 'Private staff mapping is accessible to untrusted roles';
  end if;
  if not exists (
    select 1 from melinda_private.executive_recipient_directory
    where recipient_role = 'asisten_direktur' and recipient_name = 'Sdr. Nurma'
      and contact_source = 'grokbot'
  ) then
    raise exception 'Executive assistant is not configured as Sdr. Nurma / Grokbot';
  end if;

  event := jsonb_build_object(
    'owner','director','kind','meeting','eventId','qa-executive-nurma-event',
    'meetingId',meeting,'sourceUpdatedAt',clock_timestamp(),
    'startAt',first_at,'endAt',first_at + interval '1 hour',
    'title','Rapat keuangan uji','place','Ruang direksi',
    'participants',jsonb_build_array('Bu Yuni'),
    'department','Keuangan','visibility','normal','status','confirmed',
    'sharedWithNovia',false,'producer','dash'
  );
  response := public.melinda_executive_office('calendar_upsert',event);
  if response->>'replayed' <> 'false' then
    raise exception 'Calendar upsert failed: %', response;
  end if;

  response := public.melinda_executive_office('queue','{}');
  select item into receipt from jsonb_array_elements(response->'items') item
    where item->>'meetingId' = meeting and item->>'kind' = 'assistant_brief';
  if receipt is null or receipt->>'recipientName' <> 'Sdr. Nurma'
    or receipt->>'recipientRole' <> 'asisten_direktur' then
    raise exception 'Assistant briefing does not resolve to Nurma: %', receipt;
  end if;
  if (select count(*) from melinda_private.executive_outbox
      where meeting_id = meeting and recipient_role = 'asisten_direktur'
        and recipient_name = 'Sdr. Nurma') <> 2 then
    raise exception 'Both the briefing and readiness reminder must go to Nurma';
  end if;
  if not exists (
    select 1 from jsonb_array_elements(response->'items') item
      where item->>'meetingId' = meeting and item->>'kind' = 'department_invitation'
        and item->>'recipientName' = 'Bu Yuni'
  ) then
    raise exception 'Existing finance contact mapping was unintentionally changed';
  end if;
  if exists (
    select 1 from melinda_private.executive_outbox
    where meeting_id = meeting and (recipient_name ~ '[0-9]{9,}' or recipient_role ~ '[0-9]{9,}')
  ) then
    raise exception 'A phone number leaked into MelindaOS';
  end if;

  -- The role-to-name mapping can be changed without updating the core RPC.
  update melinda_private.executive_recipient_directory
    set recipient_name = 'Sdr. Nurma QA', updated_at = clock_timestamp()
    where recipient_role = 'asisten_direktur';
  insert into melinda_private.executive_outbox
    (delivery_key, meeting_id, kind, recipient_role, due_at, meeting_title, starts_at)
  values
    ('qa-nurma-direct', meeting, 'assistant_brief', 'asisten_direktur',
      first_at - interval '1 day', 'Rapat uji', first_at);
  if not exists (
    select 1 from melinda_private.executive_outbox
      where delivery_key = 'qa-nurma-direct' and recipient_name = 'Sdr. Nurma QA'
  ) then
    raise exception 'New recipient mapping was not used for outgoing notifications';
  end if;
end;
$$;
rollback;
