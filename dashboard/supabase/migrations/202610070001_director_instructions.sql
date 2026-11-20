begin;

create sequence melinda_private.instruction_seq;
create table melinda_private.instructions (
  id text primary key default ('IOC-' || lpad(nextval('melinda_private.instruction_seq')::text, 4, '0')),
  reviewer text not null, request_key text not null, request_hash text not null check (length(request_hash) = 64),
  report_date date not null, section text not null check (section in ('priorities','followUps','decisions')),
  item_id text not null, item_title text not null, urgent boolean not null,
  action text not null check (action in ('approve','request_update','assign','escalate','defer','done')),
  deadline text, pic jsonb not null default '[]', note text not null default '' check (length(note) <= 280),
  decision_option_id text, decision_label text,
  status text not null default 'dibuat' check (status in ('dibuat','terkirim_ke_grokbot','gagal','diteruskan','diterima_pic','dikerjakan','selesai')),
  history jsonb not null default '[]', created_at timestamptz not null default clock_timestamp(),
  unique (reviewer, request_key)
);
create index instructions_report_date on melinda_private.instructions (report_date, created_at);
alter table melinda_private.instructions enable row level security;
revoke all on melinda_private.instructions from public, anon, authenticated, service_role;
revoke all on sequence melinda_private.instruction_seq from public, anon, authenticated, service_role;

create function public.melinda_director_instructions(command text, args jsonb)
returns jsonb language plpgsql security definer set search_path = ''
set lock_timeout = '1s' set statement_timeout = '5s'
as $$
declare
  item melinda_private.instructions%rowtype;
  result jsonb;
  progress text[] := array['terkirim_ke_grokbot','diteruskan','diterima_pic','dikerjakan','selesai'];
  replayed boolean := false;
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
    if coalesce(array_position(progress, item.status), 0) = 0
      or coalesce(array_position(progress, args->>'status'), 0) <= array_position(progress, item.status) then
      return jsonb_build_object('errorCode', 'conflict');
    end if;
    update melinda_private.instructions set status = args->>'status',
      history = history || jsonb_build_object('status', args->>'status', 'at', clock_timestamp(), 'actor', args->>'actor')
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
  else
    return jsonb_build_object('errorCode', 'invalid_command');
  end if;
  return jsonb_build_object('instruction', jsonb_build_object('id', item.id, 'reportDate', item.report_date, 'section', item.section,
    'itemId', item.item_id, 'itemTitle', item.item_title, 'urgent', item.urgent, 'action', item.action, 'deadline', item.deadline,
    'pic', item.pic, 'note', item.note, 'decisionOptionId', item.decision_option_id, 'decisionLabel', item.decision_label,
    'status', item.status, 'history', item.history, 'createdAt', item.created_at), 'replayed', replayed);
end;
$$;

revoke all on function public.melinda_director_instructions(text, jsonb) from public, anon, authenticated;
grant execute on function public.melinda_director_instructions(text, jsonb) to service_role;
comment on function public.melinda_director_instructions(text, jsonb) is 'Server-only Director instructions. Never expose the Supabase secret key to a browser or Bot.';
commit;
