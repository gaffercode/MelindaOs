-- A send failure before delivery (WhatsApp timeout, unknown number) could not reach the dashboard: `terkendala`
-- was only allowed from diteruskan/diterima_pic/dikerjakan, so a failed instruction looked like one never picked up.
-- Two rules are added to `advance`: dibuat/gagal -> terkendala, note required (the reason the Director sees);
-- terkendala -> diteruskan/diterima_pic, only while the history holds no forward status (the block happened
-- before delivery), so a resend can be reported without ever moving backward. Replaces the function body from
-- 202610290002_director_instructions_open; nothing else changes. Run it after that migration.
-- Apply in the Supabase SQL Editor before deploying the dashboard build whose canAdvance mirrors it.
begin;
create or replace function public.melinda_director_instructions(command text, args jsonb)
returns jsonb language plpgsql security definer set search_path = ''
set lock_timeout = '1s' set statement_timeout = '5s'
as $$
declare
  item melinda_private.instructions%rowtype;
  result jsonb;
  progress text[] := array['terkirim_ke_grokbot','diteruskan','diterima_pic','dikerjakan','selesai'];
  forward text[] := array['diteruskan','diterima_pic','dikerjakan','selesai'];
  replayed boolean := false;
  history_note text;
  from_status text;
  to_status text;
  allowed boolean;
begin
  if command = 'create' then
    perform pg_advisory_xact_lock(hashtextextended('instruction:' || (args->>'reviewerId') || ':' || (args->>'key'), 0));
    select * into item from melinda_private.instructions where reviewer = args->>'reviewerId' and request_key = args->>'key';
    if found then
      if item.request_hash <> args->>'requestHash' then return jsonb_build_object('errorCode', 'conflict'); end if;
      replayed := true;
    else
      insert into melinda_private.instructions(reviewer, request_key, request_hash, report_date, section, item_id, item_title, urgent,
        action, deadline, pic, note, decision_option_id, decision_label, history)
      values(args->>'reviewerId', args->>'key', args->>'requestHash', (args->>'reportDate')::date, args->>'section', args->>'itemId',
        args->>'itemTitle', (args->>'urgent')::boolean, args->>'action', args->>'deadline', coalesce(args->'pic', '[]'), coalesce(args->>'note', ''),
        args->>'decisionOptionId', args->>'decisionLabel',
        jsonb_build_array(jsonb_build_object('status', 'dibuat', 'at', clock_timestamp(), 'actor', args->>'reviewerId')))
      returning * into item;
    end if;
  elsif command = 'mark' then
    if args->>'status' not in ('terkirim_ke_grokbot','gagal') then return jsonb_build_object('errorCode', 'invalid_status'); end if;
    select * into item from melinda_private.instructions where id = args->>'id' for update;
    if not found then return jsonb_build_object('errorCode', 'not_found'); end if;
    if item.status not in ('dibuat','gagal') then return jsonb_build_object('errorCode', 'conflict'); end if;
    update melinda_private.instructions set status = args->>'status',
      history = history || jsonb_build_object('status', args->>'status', 'at', clock_timestamp(), 'actor', args->>'actor')
      where id = item.id returning * into item;
  elsif command = 'advance' then
    select * into item from melinda_private.instructions where id = args->>'id' for update;
    if not found then return jsonb_build_object('errorCode', 'not_found'); end if;
    history_note := nullif(btrim(coalesce(args->>'note', '')), '');
    if history_note is not null and (length(history_note) > 280 or history_note ~ '[[:cntrl:]]') then
      return jsonb_build_object('errorCode', 'invalid_status');
    end if;
    from_status := item.status;
    to_status := args->>'status';
    allowed := false;
    if from_status in ('dibuat','gagal') and to_status = any (forward) then
      allowed := true;
    elsif from_status in ('diteruskan','diterima_pic','dikerjakan') and to_status = 'terkendala' then
      allowed := true;
    elsif from_status in ('dibuat','gagal') and to_status = 'terkendala' and history_note is not null then
      allowed := true;
    elsif from_status = 'terkendala' and to_status in ('dikerjakan','selesai') then
      allowed := true;
    elsif from_status = 'terkendala' and to_status in ('diteruskan','diterima_pic')
      and not exists (select 1 from jsonb_array_elements(item.history) h where h->>'status' = any (forward)) then
      allowed := true;
    elsif from_status = 'terkendala' and to_status = 'terkendala' and history_note is not null
      and history_note is distinct from (item.history -> -1 ->> 'note') then
      allowed := true;
    elsif from_status = any (progress) and to_status = any (progress)
      and coalesce(array_position(progress, to_status), 0) > coalesce(array_position(progress, from_status), 0) then
      allowed := true;
    end if;
    if not allowed then return jsonb_build_object('errorCode', 'conflict'); end if;
    update melinda_private.instructions set status = to_status,
      history = history || case when history_note is null
        then jsonb_build_object('status', to_status, 'at', clock_timestamp(), 'actor', args->>'actor')
        else jsonb_build_object('status', to_status, 'at', clock_timestamp(), 'actor', args->>'actor', 'note', history_note)
      end
      where id = item.id returning * into item;
  elsif command = 'read' then
    select * into item from melinda_private.instructions where id = args->>'id';
    if not found then return jsonb_build_object('errorCode', 'not_found'); end if;
  elsif command = 'list' then
    select jsonb_agg(jsonb_build_object('id', i.id, 'reportDate', i.report_date, 'section', i.section, 'itemId', i.item_id,
      'itemTitle', i.item_title, 'urgent', i.urgent, 'action', i.action, 'deadline', i.deadline, 'pic', i.pic, 'note', i.note,
      'decisionOptionId', i.decision_option_id, 'decisionLabel', i.decision_label, 'status', i.status, 'history', i.history,
      'createdAt', i.created_at) order by i.created_at)
      into result from (select * from melinda_private.instructions where report_date = (args->>'date')::date order by created_at limit 200) i;
    return jsonb_build_object('instructions', coalesce(result, '[]'::jsonb));
  elsif command = 'open' then
    select jsonb_agg(jsonb_build_object('id', i.id, 'reportDate', i.report_date, 'section', i.section, 'itemId', i.item_id,
      'itemTitle', i.item_title, 'urgent', i.urgent, 'action', i.action, 'deadline', i.deadline, 'pic', i.pic, 'note', i.note,
      'decisionOptionId', i.decision_option_id, 'decisionLabel', i.decision_label, 'status', i.status, 'history', i.history,
      'createdAt', i.created_at) order by i.report_date, i.created_at)
      into result from (select * from melinda_private.instructions
        where report_date between (args->>'from')::date and (args->>'to')::date and status <> 'selesai' and action <> 'done'
        order by report_date, created_at limit 500) i;
    return jsonb_build_object('instructions', coalesce(result, '[]'::jsonb));
  else
    return jsonb_build_object('errorCode', 'invalid_command');
  end if;
  return jsonb_build_object('instruction', jsonb_build_object('id', item.id, 'reportDate', item.report_date, 'section', item.section,
    'itemId', item.item_id, 'itemTitle', item.item_title, 'urgent', item.urgent, 'action', item.action, 'deadline', item.deadline,
    'pic', item.pic, 'note', item.note, 'decisionOptionId', item.decision_option_id, 'decisionLabel', item.decision_label,
    'status', item.status, 'history', item.history, 'createdAt', item.created_at), 'replayed', replayed);
end;
$$;
commit;
