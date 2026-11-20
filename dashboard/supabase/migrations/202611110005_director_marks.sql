-- Director marks: keeps the Director's two kinds of marks in the database instead of the browser, so they
-- follow the Director across devices. Adds melinda_private.director_marks (one row per scope and key; scope
-- is task_reply_read or email_handling) and public.melinda_director_marks(command, args), a server-only
-- command surface. `list` takes {scope, prefix?} and returns {"marks": [{"key", "value"}]}, newest first,
-- at most 1000. `set` takes {scope, reviewer, items: [{key, value}]} (1 to 200 items) and returns
-- {"saved": n}. Invalid input or any other command returns {"errorCode": "invalid_command"} and writes
-- nothing. The function does not know what values mean; the dashboard decides that per scope.
-- It replaces no existing function or table.
-- Apply in the Supabase SQL Editor; the agent has no DB access.
begin;

select melinda_private.record_migration('202611110005', '202611110005_director_marks');

create table melinda_private.director_marks (
  scope text not null check (scope in ('task_reply_read', 'email_handling')),
  mark_key text not null check (length(mark_key) between 1 and 160),
  value text not null check (length(value) between 1 and 20),
  updated_by text not null check (length(updated_by) between 1 and 80),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (scope, mark_key)
);
alter table melinda_private.director_marks enable row level security;
revoke all on melinda_private.director_marks from public, anon, authenticated, service_role;

create function public.melinda_director_marks(command text, args jsonb)
returns jsonb language plpgsql security definer set search_path = ''
set lock_timeout = '1s' set statement_timeout = '5s'
as $$
declare
  invalid constant jsonb := jsonb_build_object('errorCode', 'invalid_command');
  v_scope text;
  v_prefix text;
  v_reviewer text;
  v_items jsonb;
  v_count integer;
  result jsonb;
begin
  if command is null or jsonb_typeof(args) is distinct from 'object' then
    return invalid;
  end if;
  if jsonb_typeof(args->'scope') is distinct from 'string' then
    return invalid;
  end if;
  v_scope := args->>'scope';
  if v_scope not in ('task_reply_read', 'email_handling') then
    return invalid;
  end if;

  if command = 'list' then
    if jsonb_typeof(args->'prefix') = 'string' then
      v_prefix := args->>'prefix';
    elsif coalesce(jsonb_typeof(args->'prefix'), 'null') <> 'null' then
      return invalid;
    end if;
    select coalesce(jsonb_agg(jsonb_build_object('key', t.mark_key, 'value', t.value)
                              order by t.updated_at desc, t.mark_key), '[]'::jsonb)
      into result
      from (
        select m.mark_key, m.value, m.updated_at
          from melinda_private.director_marks m
         where m.scope = v_scope
           and (v_prefix is null or left(m.mark_key, length(v_prefix)) = v_prefix)
         order by m.updated_at desc, m.mark_key
         limit 1000
      ) t;
    return jsonb_build_object('marks', result);
  end if;

  if command = 'set' then
    if jsonb_typeof(args->'reviewer') is distinct from 'string' then
      return invalid;
    end if;
    v_reviewer := args->>'reviewer';
    if length(v_reviewer) not between 1 and 80 then
      return invalid;
    end if;
    v_items := args->'items';
    if jsonb_typeof(v_items) is distinct from 'array' then
      return invalid;
    end if;
    v_count := jsonb_array_length(v_items);
    if v_count not between 1 and 200 then
      return invalid;
    end if;
    -- validate every item before the first write
    if exists (
      select 1 from jsonb_array_elements(v_items) e(item)
       where jsonb_typeof(e.item) is distinct from 'object'
          or jsonb_typeof(e.item->'key') is distinct from 'string'
          or jsonb_typeof(e.item->'value') is distinct from 'string'
          or coalesce(length(e.item->>'key') not between 1 and 160, true)
          or coalesce(length(e.item->>'value') not between 1 and 20, true)
    ) then
      return invalid;
    end if;
    -- one row per key (the last occurrence wins), in key order so concurrent calls lock rows alike
    insert into melinda_private.director_marks (scope, mark_key, value, updated_by)
    select v_scope, d.mark_key, d.value, v_reviewer
      from (
        select distinct on (e.item->>'key') e.item->>'key' as mark_key, e.item->>'value' as value
          from jsonb_array_elements(v_items) with ordinality e(item, ord)
         order by e.item->>'key', e.ord desc
      ) d
     order by d.mark_key
    on conflict (scope, mark_key) do update
      set value = excluded.value,
          updated_by = excluded.updated_by,
          updated_at = clock_timestamp();
    return jsonb_build_object('saved', v_count);
  end if;

  return invalid;
end;
$$;

revoke all on function public.melinda_director_marks(text, jsonb) from public, anon, authenticated;
grant execute on function public.melinda_director_marks(text, jsonb) to service_role;

commit;
