-- STARKES audit scores (Tim Mutu draft → submit → Direktur lock). Apply in Supabase SQL Editor after prior migrations.
begin;

create table melinda_private.starkes_ep_scores (
  ep_id text primary key,
  chapter_code text not null,
  score integer not null check (score in (0, 5, 10)),
  note text not null default '' check (char_length(note) <= 500),
  evidence_status text not null check (evidence_status in ('missing', 'draft', 'linked', 'verified', 'not_applicable')),
  lock_state text not null default 'draft' check (lock_state in ('draft', 'submitted', 'locked')),
  updated_by text not null,
  updated_at timestamptz not null default clock_timestamp(),
  locked_by text,
  locked_at timestamptz,
  attachment_refs jsonb not null default '[]'::jsonb
);

alter table melinda_private.starkes_ep_scores enable row level security;
revoke all on melinda_private.starkes_ep_scores from public, anon, authenticated, service_role;

create function public.melinda_starkes_audit(command text, args jsonb)
returns jsonb language plpgsql security definer set search_path = ''
set lock_timeout = '1s' set statement_timeout = '5s'
as $$
declare
  row melinda_private.starkes_ep_scores%rowtype;
  result jsonb;
begin
  if command = 'list' then
    select coalesce(jsonb_agg(to_jsonb(s) order by s.chapter_code, s.ep_id), '[]'::jsonb) into result
      from melinda_private.starkes_ep_scores s;
    return jsonb_build_object('scores', result);

  elsif command = 'upsert_draft' then
    select * into row from melinda_private.starkes_ep_scores where ep_id = args->>'ep_id';
    if found and row.lock_state = 'locked' then
      return jsonb_build_object('errorCode', 'conflict');
    end if;
    insert into melinda_private.starkes_ep_scores(
      ep_id, chapter_code, score, note, evidence_status, lock_state, updated_by, updated_at, attachment_refs
    ) values (
      args->>'ep_id',
      args->>'chapter_code',
      (args->>'score')::integer,
      coalesce(args->>'note', ''),
      args->>'evidence_status',
      'draft',
      args->>'updated_by',
      clock_timestamp(),
      coalesce(args->'attachment_refs', '[]'::jsonb)
    )
    on conflict (ep_id) do update set
      chapter_code = excluded.chapter_code,
      score = excluded.score,
      note = excluded.note,
      evidence_status = excluded.evidence_status,
      updated_by = excluded.updated_by,
      updated_at = clock_timestamp(),
      attachment_refs = excluded.attachment_refs
    where melinda_private.starkes_ep_scores.lock_state <> 'locked'
    returning * into row;
    if not found then
      return jsonb_build_object('errorCode', 'conflict');
    end if;
    return jsonb_build_object('score', to_jsonb(row));

  elsif command = 'submit_chapter' then
    update melinda_private.starkes_ep_scores
      set lock_state = 'submitted', updated_by = args->>'updated_by', updated_at = clock_timestamp()
      where chapter_code = args->>'chapter_code' and lock_state = 'draft';
    return jsonb_build_object('ok', true);

  elsif command = 'lock' then
    if coalesce(args->>'actorRole', '') <> 'director' then
      return jsonb_build_object('errorCode', 'forbidden');
    end if;
    update melinda_private.starkes_ep_scores
      set lock_state = 'locked',
          locked_by = args->>'updated_by',
          locked_at = clock_timestamp(),
          updated_by = args->>'updated_by',
          updated_at = clock_timestamp()
      where chapter_code = args->>'chapter_code' and lock_state in ('draft', 'submitted');
    return jsonb_build_object('ok', true);

  elsif command = 'unlock' then
    if coalesce(args->>'actorRole', '') <> 'director' then
      return jsonb_build_object('errorCode', 'forbidden');
    end if;
    update melinda_private.starkes_ep_scores
      set lock_state = 'draft', locked_by = null, locked_at = null,
          updated_by = args->>'updated_by', updated_at = clock_timestamp()
      where chapter_code = args->>'chapter_code' and lock_state = 'locked';
    return jsonb_build_object('ok', true);
  end if;

  return jsonb_build_object('errorCode', 'invalid_command');
end;
$$;

revoke all on function public.melinda_starkes_audit(text, jsonb) from public, anon, authenticated;
grant execute on function public.melinda_starkes_audit(text, jsonb) to service_role;
comment on function public.melinda_starkes_audit(text, jsonb) is 'Server-only store for STARKES EP audit scores (Mutu draft/submit, Direktur lock/unlock).';

commit;
