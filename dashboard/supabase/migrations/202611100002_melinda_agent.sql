begin;

-- Melinda, the Director's native dashboard agent: conversation history and token usage.
create table melinda_private.melinda_conversations (
  id uuid primary key default gen_random_uuid(),
  owner text not null,
  title text not null check (char_length(title) between 1 and 120),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);
create index melinda_conversations_owner on melinda_private.melinda_conversations (owner, updated_at desc);

create table melinda_private.melinda_messages (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  conversation_id uuid not null references melinda_private.melinda_conversations (id) on delete cascade,
  role text not null check (role in ('user','assistant','tool')),
  content text not null check (char_length(content) <= 200000),
  tool_calls jsonb,
  sources jsonb not null default '[]',
  tokens integer not null default 0 check (tokens >= 0),
  complete boolean not null default true,
  day text not null,
  created_at timestamptz not null default clock_timestamp()
);
create index melinda_messages_conversation on melinda_private.melinda_messages (conversation_id, seq);
create index melinda_messages_day on melinda_private.melinda_messages (day);

alter table melinda_private.melinda_conversations enable row level security;
alter table melinda_private.melinda_messages enable row level security;
revoke all on melinda_private.melinda_conversations from public, anon, authenticated, service_role;
revoke all on melinda_private.melinda_messages from public, anon, authenticated, service_role;

create function public.melinda_agent(command text, args jsonb)
returns jsonb language plpgsql security definer set search_path = ''
set lock_timeout = '1s' set statement_timeout = '5s'
as $$
declare
  conversation melinda_private.melinda_conversations%rowtype;
  owner_id text := args->>'owner';
  target text := coalesce(args->>'id', args->>'conversationId');
  target_id uuid;
  window_size integer := greatest(coalesce((args->>'limit')::integer, 20), 1);
  result jsonb;
begin
  if owner_id is null or owner_id = '' then return jsonb_build_object('errorCode', 'invalid_input'); end if;

  if command = 'create' then
    if coalesce(btrim(args->>'title'), '') = '' then return jsonb_build_object('errorCode', 'invalid_input'); end if;
    insert into melinda_private.melinda_conversations (owner, title)
    values (owner_id, left(btrim(args->>'title'), 120)) returning * into conversation;
    return jsonb_build_object('conversation', jsonb_build_object('id', conversation.id, 'title', conversation.title, 'updatedAt', conversation.updated_at));
  elsif command = 'list' then
    select coalesce(jsonb_agg(jsonb_build_object('id', rows.id, 'title', rows.title, 'updatedAt', rows.updated_at) order by rows.updated_at desc), '[]') into result from (
      select c.id, c.title, c.updated_at from melinda_private.melinda_conversations c
      where c.owner = owner_id order by c.updated_at desc limit 50
    ) rows;
    return jsonb_build_object('conversations', result);
  elsif command = 'usage_today' then
    select to_jsonb(coalesce(sum(m.tokens), 0)) into result from melinda_private.melinda_messages m
    join melinda_private.melinda_conversations c on c.id = m.conversation_id
    where c.owner = owner_id and m.day = args->>'day';
    return jsonb_build_object('tokens', result);
  elsif command not in ('read','delete','append','history') then
    return jsonb_build_object('errorCode', 'invalid_command');
  end if;

  -- Every remaining command names one conversation: a malformed id and another owner's id both read as not found.
  begin
    target_id := target::uuid;
  exception when invalid_text_representation then
    return jsonb_build_object('errorCode', 'not_found');
  end;
  select * into conversation from melinda_private.melinda_conversations c where c.id = target_id and c.owner = owner_id;
  if not found then return jsonb_build_object('errorCode', 'not_found'); end if;

  if command = 'read' then
    select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'role', m.role, 'content', m.content, 'sources', m.sources, 'complete', m.complete, 'createdAt', m.created_at) order by m.seq), '[]')
    into result from melinda_private.melinda_messages m where m.conversation_id = target_id and m.role in ('user','assistant');
    return jsonb_build_object('conversation', jsonb_build_object('id', conversation.id, 'title', conversation.title, 'updatedAt', conversation.updated_at), 'messages', result);
  elsif command = 'delete' then
    delete from melinda_private.melinda_conversations c where c.id = target_id;
    return jsonb_build_object('deleted', true);
  elsif command = 'append' then
    if args->>'role' not in ('user','assistant','tool') or args->>'content' is null or char_length(args->>'content') > 200000 then
      return jsonb_build_object('errorCode', 'invalid_input');
    end if;
    insert into melinda_private.melinda_messages (conversation_id, role, content, tool_calls, sources, tokens, complete, day)
    values (target_id, args->>'role', args->>'content', nullif(args->'toolCalls', 'null'::jsonb), coalesce(args->'sources', '[]'::jsonb),
      coalesce((args->>'tokens')::integer, 0), coalesce((args->>'complete')::boolean, true), to_char(now() at time zone 'Asia/Jakarta', 'YYYY-MM-DD'));
    update melinda_private.melinda_conversations c set updated_at = clock_timestamp() where c.id = target_id;
    return jsonb_build_object('ok', true);
  end if;

  -- history: the newest messages, oldest first, never opening on an assistant turn (the API needs a user turn first).
  with recent as (
    select m.seq, m.role, m.content from melinda_private.melinda_messages m
    where m.conversation_id = target_id and m.role in ('user','assistant') and m.content <> ''
    order by m.seq desc limit window_size
  )
  select coalesce(jsonb_agg(jsonb_build_object('role', r.role, 'content', r.content) order by r.seq), '[]') into result
  from recent r where r.seq >= (select min(u.seq) from recent u where u.role = 'user');
  return jsonb_build_object('messages', result);
end;
$$;

revoke all on function public.melinda_agent(text, jsonb) from public, anon, authenticated;
grant execute on function public.melinda_agent(text, jsonb) to service_role;
comment on function public.melinda_agent(text, jsonb) is 'Server-only Melinda agent history. Never expose the Supabase secret key to a browser or Bot.';

commit;
