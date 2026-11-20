-- STARKES evidence register: KB regulations and Google Drive file metadata matched to EPs (no file contents).
-- Apply in Supabase SQL Editor after prior migrations.
begin;

create table melinda_private.starkes_evidence (
  id uuid primary key default gen_random_uuid(),
  ep_ids text[] not null default '{}',
  chapter_code text not null,
  kind text check (kind in ('R', 'D', 'O', 'W', 'S')),
  source text not null check (source in ('kb', 'drive')),
  ref text not null, -- KB doc_id or Drive file id
  name text,
  mime text,
  web_link text,
  modified_at timestamptz,
  matched_by text check (matched_by in ('ai', 'director', 'rule')),
  confidence numeric check (confidence between 0 and 1),
  phi_flag boolean not null default false,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'withdrawn')),
  decided_at timestamptz,
  unique (source, ref)
);

alter table melinda_private.starkes_evidence enable row level security;
revoke all on melinda_private.starkes_evidence from public, anon, authenticated, service_role;

create function public.melinda_starkes_evidence(command text, args jsonb)
returns jsonb language plpgsql security definer set search_path = ''
set lock_timeout = '1s' set statement_timeout = '5s'
as $$
declare
  item jsonb;
  changed integer;
begin
  if command = 'list' then
    return jsonb_build_object('evidence', coalesce(
      (select jsonb_agg(to_jsonb(e) order by e.chapter_code, e.name, e.ref) from melinda_private.starkes_evidence e), '[]'::jsonb));

  elsif command = 'upsert_pending' then
    for item in select * from jsonb_array_elements(coalesce(args->'rows', '[]'::jsonb)) loop
      insert into melinda_private.starkes_evidence as e (
        ep_ids, chapter_code, kind, source, ref, name, mime, web_link, modified_at, matched_by, confidence, phi_flag, status
      ) values (
        coalesce((select array_agg(v) from jsonb_array_elements_text(item->'ep_ids') v), '{}'),
        item->>'chapter_code', item->>'kind', item->>'source', item->>'ref', item->>'name', item->>'mime',
        item->>'web_link', (item->>'modified_at')::timestamptz, item->>'matched_by', (item->>'confidence')::numeric,
        coalesce((item->>'phi_flag')::boolean, false), 'pending'
      )
      on conflict (source, ref) do update set
        ep_ids = excluded.ep_ids, chapter_code = excluded.chapter_code, kind = excluded.kind, name = excluded.name,
        mime = excluded.mime, web_link = excluded.web_link, modified_at = excluded.modified_at,
        matched_by = excluded.matched_by, confidence = excluded.confidence, phi_flag = excluded.phi_flag,
        -- a changed, moved or reappearing file needs a new decision
        status = case when e.modified_at is distinct from excluded.modified_at or e.chapter_code <> excluded.chapter_code
                        or e.status = 'withdrawn' then 'pending' else e.status end,
        decided_at = case when e.modified_at is distinct from excluded.modified_at or e.chapter_code <> excluded.chapter_code
                            or e.status = 'withdrawn' then null else e.decided_at end;
    end loop;
    return jsonb_build_object('ok', true);

  elsif command = 'decide_batch' then
    if coalesce(args->>'status', '') not in ('approved', 'rejected') then
      return jsonb_build_object('errorCode', 'invalid_status');
    end if;
    update melinda_private.starkes_evidence
      set status = args->>'status', decided_at = clock_timestamp()
      where id::text in (select jsonb_array_elements_text(coalesce(args->'ids', '[]'::jsonb))) and status <> 'withdrawn';
    get diagnostics changed = row_count;
    return jsonb_build_object('updated', changed);

  elsif command = 'withdraw_missing' then
    update melinda_private.starkes_evidence
      set status = 'withdrawn', decided_at = clock_timestamp()
      where source = 'drive' and chapter_code = args->>'chapter_code' and status <> 'withdrawn'
        and ref not in (select jsonb_array_elements_text(coalesce(args->'present_refs', '[]'::jsonb)));
    get diagnostics changed = row_count;
    return jsonb_build_object('withdrawn', changed);
  end if;

  return jsonb_build_object('errorCode', 'invalid_command');
end;
$$;

revoke all on function public.melinda_starkes_evidence(text, jsonb) from public, anon, authenticated;
grant execute on function public.melinda_starkes_evidence(text, jsonb) to service_role;
comment on function public.melinda_starkes_evidence(text, jsonb) is 'Server-only store for STARKES evidence metadata (KB and Google Drive), Director decisions.';

commit;
