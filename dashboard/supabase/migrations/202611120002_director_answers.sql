-- Director answers: keeps what the Director answered for each open line of an approved document, until a
-- person applies the answers to the documents with tools/readiness. Adds melinda_private.director_answers
-- (one row per document line, keyed by the line's id in the Director queue file) and
-- public.melinda_director_answers(command, args), a server-only command surface. `list` takes {} and returns
-- {"answers": [{"id", "docPath", "lineText", "slots", "answeredBy", "answeredAt"}]}, newest first, at most
-- 2000. `set` takes {reviewer, item: {id, docPath, lineText, slots}} and inserts or replaces that line's row;
-- it returns {"saved": 1}. `clear` takes {id} and returns {"cleared": 0} or {"cleared": 1}. Each slot is
-- {column, placeholder, decision, text}; other keys are dropped. Invalid input or any other command returns
-- {"errorCode": "invalid_command"} and writes nothing. The function checks shapes and lengths only; the
-- dashboard decides which decision a placeholder may take.
-- It replaces no existing function or table.
-- Apply in the Supabase SQL Editor; the agent has no DB access.
begin;

select melinda_private.record_migration('202611120002', '202611120002_director_answers');

create table melinda_private.director_answers (
  item_id text primary key check (item_id ~ '^[0-9a-f]{16}$'),
  doc_path text not null check (length(doc_path) between 1 and 300),
  line_text text not null check (length(line_text) between 1 and 2000),
  slots jsonb not null check (case when jsonb_typeof(slots) = 'array' then jsonb_array_length(slots) between 1 and 12 else false end),
  answered_by text not null check (length(answered_by) between 1 and 80),
  answered_at timestamptz not null default clock_timestamp()
);
alter table melinda_private.director_answers enable row level security;
revoke all on melinda_private.director_answers from public, anon, authenticated, service_role;

create function public.melinda_director_answers(command text, args jsonb)
returns jsonb language plpgsql security definer set search_path = ''
set lock_timeout = '1s' set statement_timeout = '5s'
as $$
declare
  invalid constant jsonb := jsonb_build_object('errorCode', 'invalid_command');
  id_pattern constant text := '^[0-9a-f]{16}$';
  v_item jsonb;
  v_id text;
  v_doc_path text;
  v_line_text text;
  v_reviewer text;
  v_slots jsonb;
  v_count integer;
  result jsonb;
begin
  if command is null or jsonb_typeof(args) is distinct from 'object' then
    return invalid;
  end if;

  if command = 'list' then
    select coalesce(jsonb_agg(jsonb_build_object('id', t.item_id, 'docPath', t.doc_path, 'lineText', t.line_text,
                                                 'slots', t.slots, 'answeredBy', t.answered_by, 'answeredAt', t.answered_at)
                              order by t.answered_at desc, t.item_id), '[]'::jsonb)
      into result
      from (
        select a.item_id, a.doc_path, a.line_text, a.slots, a.answered_by, a.answered_at
          from melinda_private.director_answers a
         order by a.answered_at desc, a.item_id
         limit 2000
      ) t;
    return jsonb_build_object('answers', result);
  end if;

  if command = 'clear' then
    if jsonb_typeof(args->'id') is distinct from 'string' or args->>'id' !~ id_pattern then
      return invalid;
    end if;
    delete from melinda_private.director_answers where item_id = args->>'id';
    get diagnostics v_count = row_count;
    return jsonb_build_object('cleared', v_count);
  end if;

  if command = 'set' then
    v_item := args->'item';
    if jsonb_typeof(args->'reviewer') is distinct from 'string'
      or jsonb_typeof(v_item) is distinct from 'object'
      or jsonb_typeof(v_item->'id') is distinct from 'string'
      or jsonb_typeof(v_item->'docPath') is distinct from 'string'
      or jsonb_typeof(v_item->'lineText') is distinct from 'string'
      or jsonb_typeof(v_item->'slots') is distinct from 'array' then
      return invalid;
    end if;
    v_reviewer := args->>'reviewer';
    v_id := v_item->>'id';
    v_doc_path := v_item->>'docPath';
    v_line_text := v_item->>'lineText';
    v_slots := v_item->'slots';
    if length(v_reviewer) not between 1 and 80
      or v_id !~ id_pattern
      or length(v_doc_path) not between 1 and 300
      or length(v_line_text) not between 1 and 2000
      or jsonb_array_length(v_slots) not between 1 and 12 then
      return invalid;
    end if;
    -- validate every slot before the write; the column is cast only once it is known to be a number
    if exists (
      select 1 from jsonb_array_elements(v_slots) e(slot)
       where jsonb_typeof(e.slot) is distinct from 'object'
          or jsonb_typeof(e.slot->'placeholder') is distinct from 'string'
          or jsonb_typeof(e.slot->'decision') is distinct from 'string'
          or jsonb_typeof(e.slot->'text') is distinct from 'string'
          or coalesce(length(e.slot->>'placeholder') not between 1 and 200, true)
          or coalesce(e.slot->>'decision' not in ('value', 'confirm', 'correction', 'skip'), true)
          or coalesce(length(e.slot->>'text') > 300, true)
          or case when jsonb_typeof(e.slot->'column') = 'number'
                  then (e.slot->>'column')::numeric not between 0 and 2000
                    or (e.slot->>'column')::numeric <> trunc((e.slot->>'column')::numeric)
                  else true end
    ) then
      return invalid;
    end if;
    -- keep the four known fields of each slot, in the order received
    select jsonb_agg(jsonb_build_object('column', (e.slot->>'column')::numeric::integer, 'placeholder', e.slot->>'placeholder',
                                        'decision', e.slot->>'decision', 'text', e.slot->>'text') order by e.ord)
      into v_slots
      from jsonb_array_elements(v_slots) with ordinality e(slot, ord);
    insert into melinda_private.director_answers (item_id, doc_path, line_text, slots, answered_by)
    values (v_id, v_doc_path, v_line_text, v_slots, v_reviewer)
    on conflict (item_id) do update
      set doc_path = excluded.doc_path,
          line_text = excluded.line_text,
          slots = excluded.slots,
          answered_by = excluded.answered_by,
          answered_at = clock_timestamp();
    return jsonb_build_object('saved', 1);
  end if;

  return invalid;
end;
$$;

revoke all on function public.melinda_director_answers(text, jsonb) from public, anon, authenticated;
grant execute on function public.melinda_director_answers(text, jsonb) to service_role;

commit;
