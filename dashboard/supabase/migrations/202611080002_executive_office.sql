-- Director Executive Office: dual-calendar intake, meeting preparation, Katt delivery queue,
-- immutable readiness evidence, meeting completion, and automatic task-closure receipts.
-- Only Dash (server-only, authenticated) calls this RPC. Katt never writes MelindaOS directly.
begin;

create table melinda_private.executive_calendar (
  owner text not null check (owner in ('director','novia')),
  event_id text not null,
  meeting_id text not null,
  kind text not null check (kind in ('meeting','other')),
  source_updated_at timestamptz not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  title text not null,
  place text,
  participants jsonb not null default '[]'::jsonb,
  department text,
  visibility text not null check (visibility in ('normal','busy')),
  event_status text not null check (event_status in ('confirmed','cancelled')),
  shared_with_novia boolean not null default false,
  payload_hash text not null,
  received_at timestamptz not null default clock_timestamp(),
  primary key (owner,event_id),
  constraint executive_event_time check (ends_at > starts_at and ends_at <= starts_at + interval '24 hours'),
  constraint executive_event_title check (length(title) between 1 and 200)
);
create index executive_calendar_day on melinda_private.executive_calendar (starts_at,meeting_id);
create index executive_calendar_meeting on melinda_private.executive_calendar (meeting_id);
alter table melinda_private.executive_calendar enable row level security;
revoke all on melinda_private.executive_calendar from public,anon,authenticated,service_role;

create table melinda_private.executive_outbox (
  delivery_key text primary key,
  meeting_id text not null,
  kind text not null check (kind in ('assistant_brief','department_invitation','readiness_check')),
  recipient_role text not null,
  recipient_name text,
  department text,
  due_at timestamptz not null,
  meeting_title text not null,
  starts_at timestamptz not null,
  place text,
  state text not null default 'pending' check (state in ('pending','sent','failed','superseded')),
  message_id text,
  note text,
  created_at timestamptz not null default clock_timestamp(),
  recorded_at timestamptz
);
create index executive_outbox_pending on melinda_private.executive_outbox (due_at) where state = 'pending';
alter table melinda_private.executive_outbox enable row level security;
revoke all on melinda_private.executive_outbox from public,anon,authenticated,service_role;

create table melinda_private.executive_readiness (
  id bigint generated always as identity primary key,
  meeting_id text not null,
  checklist_item text not null check (checklist_item in ('room','equipment','attendees','department_materials','agenda','director_documents','minutes')),
  state text not null check (state in ('ready','blocked')),
  evidence text not null check (length(evidence) between 1 and 500),
  message_id text not null unique,
  recorded_at timestamptz not null default clock_timestamp()
);
create index executive_readiness_meeting on melinda_private.executive_readiness (meeting_id,checklist_item,recorded_at desc);
alter table melinda_private.executive_readiness enable row level security;
revoke all on melinda_private.executive_readiness from public,anon,authenticated,service_role;

create table melinda_private.executive_meeting_archive (
  id bigint generated always as identity primary key,
  meeting_id text not null,
  message_id text not null unique,
  outcome text not null check (length(outcome) between 1 and 2000),
  minutes_url text,
  archived_at timestamptz not null default clock_timestamp()
);
alter table melinda_private.executive_meeting_archive enable row level security;
revoke all on melinda_private.executive_meeting_archive from public,anon,authenticated,service_role;

-- Every completed task receives a separate permanent immutable receipt immediately,
-- including legacy completed tasks. Source instruction/replies remain in the original archive.
create table melinda_private.task_archive_receipts (
  instruction_id text primary key references melinda_private.instructions(id),
  final_status text not null,
  archived_at timestamptz not null default clock_timestamp(),
  snapshot jsonb not null
);
alter table melinda_private.task_archive_receipts enable row level security;
revoke all on melinda_private.task_archive_receipts from public,anon,authenticated,service_role;

create function melinda_private.capture_completed_instruction()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.status = 'selesai' or new.action = 'done' then
    insert into melinda_private.task_archive_receipts(instruction_id,final_status,snapshot)
    values (new.id,new.status,melinda_private.instruction_json(new))
    on conflict (instruction_id) do nothing;
  end if;
  return new;
end;
$$;
revoke all on function melinda_private.capture_completed_instruction() from public,anon,authenticated,service_role;
create trigger instruction_completion_receipt
after insert or update of status on melinda_private.instructions
for each row execute function melinda_private.capture_completed_instruction();
insert into melinda_private.task_archive_receipts(instruction_id,final_status,snapshot)
select i.id,i.status,melinda_private.instruction_json(i) from melinda_private.instructions i
where i.status = 'selesai' or i.action = 'done'
on conflict (instruction_id) do nothing;

create function public.melinda_executive_office(command text, args jsonb)
returns jsonb language plpgsql security definer set search_path = ''
set lock_timeout = '1s' set statement_timeout = '5s'
as $$
declare
  existing melinda_private.executive_calendar%rowtype;
  row_event melinda_private.executive_calendar%rowtype;
  queued melinda_private.executive_outbox%rowtype;
  item jsonb;
  raw_hash text;
  source_at timestamptz;
  first_at timestamptz;
  last_at timestamptz;
  deadline timestamptz;
  day date;
  message_key text;
  meeting text;
  result jsonb;
  replayed boolean := false;
begin
  if command = 'calendar_upsert' then
    if args->>'owner' not in ('director','novia')
      or args->>'kind' not in ('meeting','other')
      or args->>'visibility' not in ('normal','busy')
      or args->>'status' not in ('confirmed','cancelled')
      or coalesce(args->>'eventId','') !~ '^[A-Za-z0-9._:-]{1,180}$'
      or coalesce(args->>'meetingId','') !~ '^[A-Za-z0-9._:-]{1,120}$'
      or args->>'title' is null or length(args->>'title') not between 1 and 200
      or jsonb_typeof(args->'participants') is distinct from 'array'
      or jsonb_array_length(args->'participants') > 12
      or jsonb_typeof(args->'sharedWithNovia') is distinct from 'boolean'
      or length(args->>'place') > 120 or length(args->>'department') > 80 then
      return jsonb_build_object('errorCode','invalid_input');
    end if;
    begin
      source_at := (args->>'sourceUpdatedAt')::timestamptz;
      first_at := (args->>'startAt')::timestamptz;
      last_at := (args->>'endAt')::timestamptz;
    exception when others then
      return jsonb_build_object('errorCode','invalid_input');
    end;
    if source_at is null or first_at is null or last_at <= first_at or last_at > first_at + interval '24 hours'
      or (args->>'visibility' = 'busy' and (args->>'title' <> 'Sibuk' or args->>'department' is not null or jsonb_array_length(args->'participants') > 0)) then
      return jsonb_build_object('errorCode','invalid_input');
    end if;
    raw_hash := md5((args - 'producer')::text);
    perform pg_advisory_xact_lock(hashtextextended('office:' || (args->>'owner') || ':' || (args->>'eventId'),0));
    select * into existing from melinda_private.executive_calendar
      where owner = args->>'owner' and event_id = args->>'eventId' for update;
    if found then
      if source_at < existing.source_updated_at or (source_at = existing.source_updated_at and raw_hash <> existing.payload_hash) then
        return jsonb_build_object('errorCode','conflict');
      end if;
      replayed := source_at = existing.source_updated_at;
    end if;
    if not replayed then
      insert into melinda_private.executive_calendar
        (owner,event_id,meeting_id,kind,source_updated_at,starts_at,ends_at,title,place,participants,department,visibility,event_status,shared_with_novia,payload_hash)
      values (args->>'owner',args->>'eventId',args->>'meetingId',args->>'kind',source_at,first_at,last_at,
        args->>'title',args->>'place',args->'participants',args->>'department',args->>'visibility',args->>'status',
        (args->>'sharedWithNovia')::boolean,raw_hash)
      on conflict (owner,event_id) do update set
        meeting_id = excluded.meeting_id,kind = excluded.kind,source_updated_at = excluded.source_updated_at,
        starts_at = excluded.starts_at,ends_at = excluded.ends_at,title = excluded.title,place = excluded.place,
        participants = excluded.participants,department = excluded.department,visibility = excluded.visibility,
        event_status = excluded.event_status,shared_with_novia = excluded.shared_with_novia,payload_hash = excluded.payload_hash,
        received_at = clock_timestamp();
      if args->>'owner' = 'director' then
        update melinda_private.executive_outbox set state = 'superseded'
          where meeting_id = args->>'meetingId' and state = 'pending';
        if args->>'kind' = 'meeting' and args->>'status' = 'confirmed' and args->>'visibility' = 'normal' then
          deadline := (((first_at at time zone 'Asia/Jakarta')::date - 1) + time '16:30') at time zone 'Asia/Jakarta';
          message_key := 'exec:' || md5(args->>'meetingId') || ':' || extract(epoch from source_at)::bigint;
          insert into melinda_private.executive_outbox
            (delivery_key,meeting_id,kind,recipient_role,recipient_name,department,due_at,meeting_title,starts_at,place)
          values (message_key || ':assistant',args->>'meetingId','assistant_brief','asisten_direktur',null,
            args->>'department',deadline,args->>'title',first_at,args->>'place'),
            (message_key || ':check',args->>'meetingId','readiness_check','asisten_direktur',null,
            args->>'department',first_at - interval '30 minutes',args->>'title',first_at,args->>'place')
          on conflict (delivery_key) do nothing;
          if nullif(btrim(args->>'department'),'') is not null then
            insert into melinda_private.executive_outbox
              (delivery_key,meeting_id,kind,recipient_role,recipient_name,department,due_at,meeting_title,starts_at,place)
            values (message_key || ':department',args->>'meetingId','department_invitation','pic_departemen',
              case when lower(btrim(args->>'department')) in ('keuangan','finance','departemen keuangan') then 'Bu Yuni' else null end,
              args->>'department',deadline,args->>'title',first_at,args->>'place')
            on conflict (delivery_key) do nothing;
          end if;
        end if;
      end if;
    end if;
    return jsonb_build_object('meetingId',args->>'meetingId','replayed',replayed);

  elsif command = 'readiness_update' then
    meeting := args->>'meetingId';
    if coalesce(meeting,'') !~ '^[A-Za-z0-9._:-]{1,120}$'
      or args->>'item' not in ('room','equipment','attendees','department_materials','agenda','director_documents','minutes')
      or args->>'state' not in ('ready','blocked') or length(args->>'evidence') not between 1 and 500
      or coalesce(args->>'messageId','') !~ '^[A-Za-z0-9._:-]{1,180}$'
      or not exists (select 1 from melinda_private.executive_calendar where owner = 'director' and meeting_id = meeting) then
      return jsonb_build_object('errorCode','invalid_input');
    end if;
    insert into melinda_private.executive_readiness(meeting_id,checklist_item,state,evidence,message_id)
    values(meeting,args->>'item',args->>'state',args->>'evidence',args->>'messageId')
    on conflict (message_id) do nothing;
    return jsonb_build_object('meetingId',meeting,'recorded',true);

  elsif command = 'delivery_ack' then
    if coalesce(args->>'key','') !~ '^[A-Za-z0-9._:-]{1,180}$'
      or coalesce(args->>'messageId','') !~ '^[A-Za-z0-9._:-]{1,180}$'
      or args->>'state' not in ('sent','failed') or length(args->>'note') > 280 then
      return jsonb_build_object('errorCode','invalid_input');
    end if;
    select * into queued from melinda_private.executive_outbox
      where delivery_key = args->>'key' for update;
    if not found then return jsonb_build_object('errorCode','not_found'); end if;
    if queued.state = 'superseded' or (queued.state = 'sent' and (queued.message_id <> args->>'messageId' or args->>'state' <> 'sent')) then
      return jsonb_build_object('errorCode','conflict');
    end if;
    if queued.state <> 'sent' then
      update melinda_private.executive_outbox
      set state = args->>'state', message_id = args->>'messageId', note = args->>'note', recorded_at = clock_timestamp()
      where delivery_key = queued.delivery_key;
    end if;
    return jsonb_build_object('key',queued.delivery_key,'state',args->>'state','replayed',queued.state = 'sent');

  elsif command = 'meeting_close' then
    meeting := args->>'meetingId';
    if coalesce(meeting,'') !~ '^[A-Za-z0-9._:-]{1,120}$'
      or coalesce(args->>'messageId','') !~ '^[A-Za-z0-9._:-]{1,180}$'
      or length(args->>'outcome') not between 1 and 2000
      or length(args->>'minutesUrl') > 500
      or (args->>'minutesUrl' is not null and args->>'minutesUrl' !~ '^https://')
      or not exists (select 1 from melinda_private.executive_calendar where owner = 'director' and meeting_id = meeting) then
      return jsonb_build_object('errorCode','invalid_input');
    end if;
    insert into melinda_private.executive_meeting_archive(meeting_id,message_id,outcome,minutes_url)
      values(meeting,args->>'messageId',args->>'outcome',args->>'minutesUrl')
      on conflict (message_id) do nothing;
    return jsonb_build_object('meetingId',meeting,'archived',true);

  elsif command = 'queue' then
    select jsonb_agg(jsonb_build_object(
        'key',o.delivery_key,'meetingId',o.meeting_id,'kind',o.kind,'recipientRole',o.recipient_role,
        'recipientName',o.recipient_name,'department',o.department,'dueAt',o.due_at,
        'title',o.meeting_title,'startAt',o.starts_at,'place',o.place) order by o.due_at,o.delivery_key)
    into result from (
      select * from melinda_private.executive_outbox x
      where x.state = 'pending' and x.due_at <= clock_timestamp()
        -- Shared meetings must be visible on Novia's calendar before inviting the department.
        and (x.kind <> 'department_invitation' or not exists (
          select 1 from melinda_private.executive_calendar d
          where d.owner = 'director' and d.meeting_id = x.meeting_id and d.shared_with_novia
            and not exists (select 1 from melinda_private.executive_calendar n
              where n.owner = 'novia' and n.meeting_id = d.meeting_id and n.event_status = 'confirmed'
                and n.starts_at = d.starts_at and n.ends_at = d.ends_at)))
      order by x.due_at,x.delivery_key limit 100
    ) o;
    return jsonb_build_object('items',coalesce(result,'[]'::jsonb));

  elsif command = 'plan' then
    begin day := (args->>'date')::date;
    exception when others then return jsonb_build_object('errorCode','invalid_input'); end;
    if day is null then return jsonb_build_object('errorCode','invalid_input'); end if;
    return jsonb_build_object(
      'date',day,
      'events',coalesce((select jsonb_agg(jsonb_build_object(
        'owner',c.owner,'kind',c.kind,'eventId',c.event_id,'meetingId',c.meeting_id,
        'startAt',c.starts_at,'endAt',c.ends_at,'title',c.title,'place',c.place,'department',c.department,
        'visibility',c.visibility,'status',c.event_status,'sharedWithNovia',c.shared_with_novia)
        order by c.starts_at)
        from melinda_private.executive_calendar c
        where (c.starts_at at time zone 'Asia/Jakarta')::date = day),'[]'::jsonb),
      'readiness',coalesce((select jsonb_agg(jsonb_build_object(
        'meetingId',r.meeting_id,'item',r.checklist_item,'state',r.state,'evidence',r.evidence,'recordedAt',r.recorded_at)
        order by r.recorded_at)
        from melinda_private.executive_readiness r where exists (
          select 1 from melinda_private.executive_calendar c where c.owner = 'director' and c.meeting_id = r.meeting_id
            and (c.starts_at at time zone 'Asia/Jakarta')::date = day)),'[]'::jsonb),
      'outbox',coalesce((select jsonb_agg(jsonb_build_object(
        'key',o.delivery_key,'meetingId',o.meeting_id,'kind',o.kind,'state',o.state,'recordedAt',o.recorded_at)
        order by o.created_at) from melinda_private.executive_outbox o where exists (
          select 1 from melinda_private.executive_calendar c where c.owner = 'director' and c.meeting_id = o.meeting_id
            and (c.starts_at at time zone 'Asia/Jakarta')::date = day)),'[]'::jsonb),
      'archives',coalesce((select jsonb_agg(jsonb_build_object('meetingId',a.meeting_id,'archivedAt',a.archived_at,'minutesUrl',a.minutes_url)
        order by a.archived_at) from melinda_private.executive_meeting_archive a where exists (
          select 1 from melinda_private.executive_calendar c where c.owner = 'director' and c.meeting_id = a.meeting_id
            and (c.starts_at at time zone 'Asia/Jakarta')::date = day)),'[]'::jsonb)
    );
  end if;
  return jsonb_build_object('errorCode','invalid_command');
end;
$$;
revoke all on function public.melinda_executive_office(text,jsonb) from public,anon,authenticated;
grant execute on function public.melinda_executive_office(text,jsonb) to service_role;
comment on function public.melinda_executive_office(text,jsonb) is 'Server-only executive office calendar, preparation, delivery, and archiving contract.';
commit;
