-- Melinda actions: a change Melinda prepares in chat (new PIC, task status, follow-up, new task, page sync,
-- schedule change) waits here until the Director clicks Konfirmasi or Batal. The model never sees a token: the
-- dashboard confirms by id, for the same owner, once, before `expires_at`, and checks the payload hash it stored.
-- Commands: propose, claim (pending -> confirmed, returns the payload), finish (confirmed -> executed or failed),
-- cancel (pending -> cancelled). Executable by service_role only.
-- Apply in the Supabase SQL Editor; the agent has no database access.
begin;

select melinda_private.record_migration('202611220002', '202611220002_melinda_actions');

create table melinda_private.melinda_actions (
  id uuid primary key default gen_random_uuid(),
  owner text not null check (char_length(owner) between 1 and 200),
  conversation_id uuid references melinda_private.melinda_conversations (id) on delete set null,
  kind text not null check (kind in ('ganti_pic','status_tugas','tindak_lanjut','tugas_baru','sinkron','ubah_jadwal')),
  summary text not null check (char_length(summary) between 1 and 600),
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) <= 16384),
  payload_hash text not null check (payload_hash ~ '^[a-f0-9]{64}$'),
  status text not null default 'pending' check (status in ('pending','confirmed','executed','failed','cancelled','expired')),
  result jsonb check (result is null or pg_column_size(result) <= 16384),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  decided_at timestamptz
);
create index melinda_actions_owner on melinda_private.melinda_actions (owner, created_at desc);

alter table melinda_private.melinda_actions enable row level security;
revoke all on melinda_private.melinda_actions from public, anon, authenticated, service_role;

create function public.melinda_actions(command text, args jsonb)
returns jsonb language plpgsql security definer set search_path = ''
set lock_timeout = '1s' set statement_timeout = '5s'
as $$
declare
  action melinda_private.melinda_actions%rowtype;
  owner_id text := args->>'owner';
  target_id uuid;
  ttl integer;
  conversation uuid;
begin
  if owner_id is null or btrim(owner_id) = '' or char_length(owner_id) > 200 then
    return jsonb_build_object('errorCode', 'invalid_input');
  end if;

  if command = 'propose' then
    ttl := coalesce((args->>'ttlSeconds')::integer, 900);
    if ttl not between 60 and 3600 or jsonb_typeof(args->'payload') is distinct from 'object'
      or coalesce(btrim(args->>'summary'), '') = '' or char_length(args->>'summary') > 600
      or coalesce(args->>'payloadHash', '') !~ '^[a-f0-9]{64}$' then
      return jsonb_build_object('errorCode', 'invalid_input');
    end if;
    begin
      conversation := nullif(args->>'conversationId', '')::uuid;
    exception when invalid_text_representation then
      return jsonb_build_object('errorCode', 'invalid_input');
    end;
    -- Only a conversation of the same owner may be linked.
    if conversation is not null and not exists (
      select 1 from melinda_private.melinda_conversations c where c.id = conversation and c.owner = owner_id) then
      conversation := null;
    end if;
    begin
      insert into melinda_private.melinda_actions (owner, conversation_id, kind, summary, payload, payload_hash, expires_at)
      values (owner_id, conversation, args->>'kind', btrim(args->>'summary'), args->'payload', args->>'payloadHash',
        clock_timestamp() + make_interval(secs => ttl))
      returning * into action;
    exception when check_violation then
      return jsonb_build_object('errorCode', 'invalid_input');
    end;
    return jsonb_build_object('action', jsonb_build_object('id', action.id, 'kind', action.kind, 'summary', action.summary,
      'status', action.status, 'expiresAt', action.expires_at));
  elsif command not in ('claim','finish','cancel') then
    return jsonb_build_object('errorCode', 'invalid_command');
  end if;

  begin
    target_id := (args->>'id')::uuid;
  exception when invalid_text_representation then
    return jsonb_build_object('errorCode', 'not_found');
  end;
  select * into action from melinda_private.melinda_actions a where a.id = target_id and a.owner = owner_id for update;
  if not found then return jsonb_build_object('errorCode', 'not_found'); end if;

  if command = 'claim' then
    if action.status <> 'pending' then return jsonb_build_object('errorCode', 'conflict'); end if;
    if action.expires_at <= clock_timestamp() then
      update melinda_private.melinda_actions a set status = 'expired', decided_at = clock_timestamp() where a.id = target_id;
      return jsonb_build_object('errorCode', 'expired');
    end if;
    update melinda_private.melinda_actions a set status = 'confirmed', decided_at = clock_timestamp() where a.id = target_id;
    return jsonb_build_object('action', jsonb_build_object('id', action.id, 'kind', action.kind, 'summary', action.summary,
      'payload', action.payload, 'payloadHash', action.payload_hash));
  elsif command = 'cancel' then
    if action.status <> 'pending' then return jsonb_build_object('errorCode', 'conflict'); end if;
    update melinda_private.melinda_actions a set status = 'cancelled', decided_at = clock_timestamp() where a.id = target_id;
    return jsonb_build_object('ok', true);
  end if;

  -- finish
  if action.status <> 'confirmed' or args->>'outcome' not in ('executed','failed')
    or (args->'result' is not null and jsonb_typeof(args->'result') <> 'object') then
    return jsonb_build_object('errorCode', 'conflict');
  end if;
  begin
    update melinda_private.melinda_actions a set status = args->>'outcome', result = args->'result' where a.id = target_id;
  exception when check_violation then
    return jsonb_build_object('errorCode', 'invalid_input');
  end;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.melinda_actions(text, jsonb) from public, anon, authenticated;
grant execute on function public.melinda_actions(text, jsonb) to service_role;
comment on function public.melinda_actions(text, jsonb) is 'Server-only Melinda action proposals confirmed by the Director. Never expose the Supabase secret key to a browser or Bot.';

commit;
