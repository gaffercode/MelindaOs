begin;

create table melinda_private.studio_packages (
  id uuid primary key,
  revision integer not null check (revision > 0),
  status text not null check (status in ('draft','in_review','ready_for_signature','signed','superseded')),
  content_hash text not null,
  payload jsonb not null
);
create table melinda_private.studio_revisions (
  package_id uuid references melinda_private.studio_packages(id),
  revision integer not null,
  payload jsonb not null,
  primary key (package_id, revision)
);
create table melinda_private.studio_events (
  id bigint generated always as identity primary key,
  package_id uuid references melinda_private.studio_packages(id),
  command text not null,
  actor jsonb not null,
  occurred_at timestamptz not null default clock_timestamp()
);
create table melinda_private.studio_number_series (
  id text primary key,
  format text not null,
  next_sequence integer not null check (next_sequence > 0),
  authority text not null check (authority in ('director','owner')),
  source_ids jsonb not null,
  reconciled boolean not null default false
);
create table melinda_private.studio_number_allocations (
  number text primary key,
  package_id uuid not null references melinda_private.studio_packages(id),
  document_id text not null,
  request_id text not null,
  unique(package_id, document_id)
);

alter table melinda_private.studio_packages enable row level security;
alter table melinda_private.studio_revisions enable row level security;
alter table melinda_private.studio_events enable row level security;
alter table melinda_private.studio_number_series enable row level security;
alter table melinda_private.studio_number_allocations enable row level security;
revoke all on melinda_private.studio_packages, melinda_private.studio_revisions,
  melinda_private.studio_events, melinda_private.studio_number_series,
  melinda_private.studio_number_allocations from public, anon, authenticated, service_role;

create function melinda_private.studio_canonical(value jsonb)
returns text language sql immutable set search_path = '' as $$
  select case jsonb_typeof(value)
    when 'object' then '{' || coalesce((select string_agg(to_jsonb(key)::text || ':' || melinda_private.studio_canonical(val), ',' order by key collate "C") from jsonb_each(value) as e(key,val)), '') || '}'
    when 'array' then '[' || coalesce((select string_agg(melinda_private.studio_canonical(val), ',' order by ord) from jsonb_array_elements(value) with ordinality as e(val,ord)), '') || ']'
    else value::text end
$$;
revoke all on function melinda_private.studio_canonical(jsonb) from public,anon,authenticated,service_role;

create function public.melinda_studio_documents(command text, args jsonb)
returns jsonb language plpgsql security definer set search_path = ''
set lock_timeout = '2s' set statement_timeout = '10s'
as $$
declare
  current_row melinda_private.studio_packages%rowtype;
  next_payload jsonb;
  package_id uuid;
  next_revision integer;
  result jsonb;
  doc jsonb;
  docs jsonb;
  series_row melinda_private.studio_number_series%rowtype;
  assigned_number text;
  final_hash text;
  month_roman text;

begin
  if command = 'list' then
    select coalesce(jsonb_agg(payload order by id), '[]'::jsonb) into result from melinda_private.studio_packages;
    return jsonb_build_object('result', result);
  end if;
  if command = 'get' then
    select payload into result from melinda_private.studio_packages where id = (args->>'id')::uuid;
    if not found then return jsonb_build_object('errorCode','not_found'); end if;
    return jsonb_build_object('result',result);
  end if;
  if coalesce(args->'actor'->>'role','') not in ('mutu','director') or coalesce(args->'actor'->>'reviewerId','') = '' then
    return jsonb_build_object('errorCode','forbidden');
  end if;
  if command = 'create' then
    package_id := (args->'pkg'->>'id')::uuid;
    next_payload := ((args->'pkg') - 'finalizedHash' - 'signature') || jsonb_build_object('revision',1,'status','draft','review',null);
    insert into melinda_private.studio_packages values(package_id,1,'draft',args->>'contentHash',next_payload)
      on conflict do nothing;
    if not found then return jsonb_build_object('errorCode','conflict'); end if;
    next_revision := 1;
  elsif command in ('finalize','confirm_signed') then
    if args->'actor'->>'role' <> 'director' then return jsonb_build_object('errorCode','forbidden'); end if;
    package_id := (args->>'id')::uuid;
    select * into current_row from melinda_private.studio_packages where id=package_id for update;
    if not found then return jsonb_build_object('errorCode','not_found'); end if;
    if command='confirm_signed' then
      if coalesce(args->>'evidenceRef','') = '' or (args->>'signedAt')::timestamptz > clock_timestamp() then return jsonb_build_object('errorCode','invalid_signature'); end if;
      if current_row.status='signed' and current_row.payload->'signature'->>'evidenceRef'=args->>'evidenceRef' and current_row.payload->'signature'->>'signedAt'=args->>'signedAt' then return jsonb_build_object('result',current_row.payload); end if;
      if current_row.revision <> (args->>'expectedRevision')::integer or current_row.status <> 'ready_for_signature' then return jsonb_build_object('errorCode','conflict'); end if;
      if (args->>'signedAt')::date < (current_row.payload->'finalization'->>'issueDate')::date then return jsonb_build_object('errorCode','invalid_signature'); end if;
      next_revision := current_row.revision+1;
      next_payload := current_row.payload || jsonb_build_object('revision',next_revision,'status','signed','signature',jsonb_build_object('evidenceRef',args->>'evidenceRef','signedAt',args->>'signedAt','confirmedBy',args->'actor'->>'reviewerId'));
      final_hash := current_row.content_hash;
    else
      if current_row.payload->>'snapshotHash' <> args->>'snapshotHash' or current_row.payload->>'baselineId' <> args->>'baselineId' or current_row.payload->>'applicabilityHash' <> args->>'applicabilityHash' then return jsonb_build_object('errorCode','conflict'); end if;
      if current_row.status in ('ready_for_signature','signed') and current_row.payload->'finalization'->>'requestId'=args->>'requestId' and current_row.payload->'finalization'->>'issueDate'=args->>'issueDate' then return jsonb_build_object('result',current_row.payload); end if;
      if current_row.revision <> (args->>'expectedRevision')::integer or current_row.status <> 'in_review' or current_row.content_hash <> args->>'revisionHash' or current_row.payload->'review'->>'hash' <> current_row.content_hash then return jsonb_build_object('errorCode','conflict'); end if;
      if coalesce(args->>'requestId','')='' or length(args->>'requestId')>128 or to_char((args->>'issueDate')::date,'YYYY-MM-DD') <> args->>'issueDate' then return jsonb_build_object('errorCode','invalid_request'); end if;
      -- Lock every series in a stable order before allocating any number.
      perform 1 from melinda_private.studio_number_series where id in (select value->>'kind' from jsonb_array_elements(current_row.payload->'documents')) order by id for update;
      for doc in select value from jsonb_array_elements(current_row.payload->'documents') loop
        select * into series_row from melinda_private.studio_number_series where id=doc->>'kind';
        if not found or not series_row.reconciled or series_row.authority <> doc->>'authority' or doc->>'authority' <> 'director' or jsonb_array_length(series_row.source_ids)=0 or position('{seq}' in series_row.format)=0 then return jsonb_build_object('errorCode','numbering_unreconciled'); end if;
      end loop;
      docs := '[]'::jsonb;
      month_roman := (array['I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII'])[extract(month from (args->>'issueDate')::date)::integer];
      for doc in select value from jsonb_array_elements(current_row.payload->'documents') loop
        select * into series_row from melinda_private.studio_number_series where id=doc->>'kind';
        assigned_number := replace(replace(replace(series_row.format,'{seq}',case when series_row.next_sequence < 1000 then lpad(series_row.next_sequence::text,3,'0') else series_row.next_sequence::text end),'{year}',extract(year from (args->>'issueDate')::date)::text),'{month}',month_roman);
        if assigned_number ~ '[{}]' then raise exception 'Invalid numbering format'; end if;
        insert into melinda_private.studio_number_allocations values(assigned_number,package_id,doc->>'id',args->>'requestId');
        update melinda_private.studio_number_series set next_sequence=next_sequence+1 where id=series_row.id;
        docs := docs || jsonb_build_array(doc || jsonb_build_object('number',assigned_number,'issueDate',args->>'issueDate'));
      end loop;
      next_revision := current_row.revision+1;
      next_payload := current_row.payload || jsonb_build_object('documents',docs,'revision',next_revision,'status','ready_for_signature','issues','[]'::jsonb,'finalization',jsonb_build_object('requestId',args->>'requestId','issueDate',args->>'issueDate','reviewHash',current_row.payload->'review'->>'hash'));
      final_hash := encode(sha256(convert_to(melinda_private.studio_canonical(jsonb_build_object('documents',docs,'baselineId',next_payload->'baselineId','snapshotHash',next_payload->'snapshotHash','applicabilityHash',next_payload->'applicabilityHash','applicability',next_payload->'applicability','requiredFactKeys',next_payload->'requiredFactKeys')),'UTF8')),'hex');
      next_payload := next_payload || jsonb_build_object('finalizedHash',final_hash);
    end if;
    update melinda_private.studio_packages set revision=next_revision,status=next_payload->>'status',payload=next_payload,content_hash=final_hash where id=package_id;
  elsif command in ('save','review') then
    package_id := coalesce(args->>'id',args->'pkg'->>'id')::uuid;
    select * into current_row from melinda_private.studio_packages where id = package_id for update;
    if not found then return jsonb_build_object('errorCode','not_found'); end if;
    if current_row.revision <> (args->>'expectedRevision')::integer or current_row.status not in ('draft','in_review') then
      return jsonb_build_object('errorCode','conflict');
    end if;
    next_revision := current_row.revision + 1;
    if command = 'save' then
      next_payload := ((args->'pkg') - 'finalizedHash' - 'signature') || jsonb_build_object('revision',next_revision,'status','draft','review',null);
    else
      if current_row.content_hash <> args->>'revisionHash' then return jsonb_build_object('errorCode','conflict'); end if;
      next_payload := current_row.payload || jsonb_build_object('revision',next_revision,'status','in_review','review',
        jsonb_build_object('hash',args->>'revisionHash','reviewerId',args->'actor'->>'reviewerId','reviewedAt',clock_timestamp()));
    end if;
    update melinda_private.studio_packages set revision=next_revision,status=next_payload->>'status',payload=next_payload,
      content_hash=case when command='save' then args->>'contentHash' else current_row.content_hash end where id=package_id;
  else
    return jsonb_build_object('errorCode','invalid_command');
  end if;
  insert into melinda_private.studio_revisions values(package_id,next_revision,next_payload);
  insert into melinda_private.studio_events(package_id,command,actor) values(package_id,command,args->'actor');
  return jsonb_build_object('result',next_payload);
end;
$$;
revoke all on function public.melinda_studio_documents(text,jsonb) from public,anon,authenticated;
grant execute on function public.melinda_studio_documents(text,jsonb) to service_role;
commit;
