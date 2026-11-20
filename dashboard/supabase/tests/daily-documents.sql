-- Dedicated QA only. Apply 202610240001_daily_documents.sql first; all synthetic rows roll back.
begin;
do $$
declare
  brief jsonb := '{"dateIso":"2099-01-02","title":"Synthetic brief"}';
  snapshot jsonb := '{"tanggal":"2099-01-02","metrics":[]}';
  first_receipt jsonb;
  result jsonb;
begin
  if has_function_privilege('anon', 'public.melinda_daily_documents(text,jsonb)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.melinda_daily_documents(text,jsonb)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.melinda_daily_documents(text,jsonb)', 'EXECUTE') then
    raise exception 'RPC privilege boundary failed';
  end if;
  if has_table_privilege('service_role', 'melinda_private.daily_documents', 'SELECT,INSERT,UPDATE,DELETE') then
    raise exception 'Private table boundary failed';
  end if;

  result := public.melinda_daily_documents('read', '{"kind":"something_else","date":"2099-01-02"}');
  if result->>'errorCode' <> 'invalid_kind' then raise exception 'Unknown kind accepted'; end if;
  result := public.melinda_daily_documents('submit', jsonb_build_object('kind','management_brief','producerId','qa-bot','key','qa-brief-1','date','not-a-date','payloadHash',repeat('a',64),'payload',brief));
  if result->>'errorCode' <> 'invalid_date' then raise exception 'Invalid date accepted'; end if;

  first_receipt := public.melinda_daily_documents('submit', jsonb_build_object('kind','management_brief','producerId','qa-bot','key','qa-brief-1','date','2099-01-02','payloadHash',repeat('a',64),'payload',brief));
  if first_receipt->>'replayed' <> 'false' or first_receipt->>'date' <> '2099-01-02' then raise exception 'First submission not stored'; end if;
  result := public.melinda_daily_documents('submit', jsonb_build_object('kind','management_brief','producerId','qa-bot','key','qa-brief-1','date','2099-01-02','payloadHash',repeat('a',64),'payload',brief));
  if result->>'replayed' <> 'true' or result->>'id' <> first_receipt->>'id' then raise exception 'Idempotent replay failed'; end if;
  result := public.melinda_daily_documents('submit', jsonb_build_object('kind','management_brief','producerId','qa-bot','key','qa-brief-1','date','2099-01-02','payloadHash',repeat('b',64),'payload',brief));
  if result->>'errorCode' <> 'conflict' then raise exception 'Changed payload under the same key did not conflict'; end if;

  -- A second revision for the same date wins on read; the first stays for audit.
  perform pg_sleep(0.01);
  result := public.melinda_daily_documents('submit', jsonb_build_object('kind','management_brief','producerId','qa-bot','key','qa-brief-2','date','2099-01-02','payloadHash',repeat('c',64),'payload',brief || '{"title":"Second"}'));
  result := public.melinda_daily_documents('read', '{"kind":"management_brief","date":"2099-01-02","lookbackDays":0}');
  if result->'document'->>'payload_hash' <> repeat('c',64) then raise exception 'Newest revision not served'; end if;
  if (select count(*) from melinda_private.daily_documents where kind = 'management_brief' and report_date = '2099-01-02') <> 2 then raise exception 'Revisions not retained'; end if;

  -- Lookback: six days back finds it, seven does not, and lookback is capped at six.
  result := public.melinda_daily_documents('read', '{"kind":"management_brief","date":"2099-01-08","lookbackDays":6}');
  if result->'document'->>'report_date' <> '2099-01-02' then raise exception 'Lookback within six days failed'; end if;
  result := public.melinda_daily_documents('read', '{"kind":"management_brief","date":"2099-01-09","lookbackDays":30}');
  if result->'document' <> 'null'::jsonb then raise exception 'Lookback exceeded six days'; end if;
  result := public.melinda_daily_documents('read', '{"kind":"management_brief","date":"2099-01-03","lookbackDays":0}');
  if result->'document' <> 'null'::jsonb then raise exception 'Zero lookback returned another day'; end if;

  -- Kinds are isolated.
  result := public.melinda_daily_documents('read', '{"kind":"simrs_snapshot","date":"2099-01-02","lookbackDays":6}');
  if result->'document' <> 'null'::jsonb then raise exception 'Kind isolation failed'; end if;
  result := public.melinda_daily_documents('submit', jsonb_build_object('kind','simrs_snapshot','producerId','qa-bot','key','qa-snap-1','date','2099-01-02','payloadHash',repeat('d',64),'payload',snapshot));
  result := public.melinda_daily_documents('latest', '{"kind":"simrs_snapshot"}');
  if result->'document'->>'report_date' <> '2099-01-02' or result->'document' ? 'payload' then raise exception 'Latest summary wrong'; end if;

  result := public.melinda_daily_documents('submit', jsonb_build_object('kind','medify_run_status','producerId','qa-bot','key','qa-medify-run-1','date','2099-01-02','payloadHash',repeat('f',64),'payload','{"schemaVersion":1,"date":"2099-01-02"}'::jsonb));
  if result->>'replayed' <> 'false' or result->>'kind' <> 'medify_run_status' then raise exception 'Medify run status not stored'; end if;
  result := public.melinda_daily_documents('read', '{"kind":"medify_run_status","date":"2099-01-02","lookbackDays":0}');
  if result->'document'->>'payload_hash' <> repeat('f',64) then raise exception 'Medify run status read failed'; end if;

  result := public.melinda_daily_documents('submit', jsonb_build_object('kind','satusehat_snapshot','producerId','qa-bot','key','qa-satusehat-1','date','2099-01-02','payloadHash',repeat('1',64),'payload','{"schemaVersion":1,"date":"2099-01-02"}'::jsonb));
  if result->>'replayed' <> 'false' or result->>'kind' <> 'satusehat_snapshot' then raise exception 'Satusehat snapshot not stored'; end if;
  result := public.melinda_daily_documents('read', '{"kind":"satusehat_snapshot","date":"2099-01-02","lookbackDays":0}');
  if result->'document'->>'payload_hash' <> repeat('1',64) then raise exception 'Satusehat snapshot read failed'; end if;

  -- Oversize payloads are refused.
  result := public.melinda_daily_documents('submit', jsonb_build_object('kind','management_brief','producerId','qa-bot','key','qa-big','date','2099-01-02','payloadHash',repeat('e',64),'payload',jsonb_build_object('blob', repeat('x', 257000))));
  if result->>'errorCode' <> 'invalid_payload' then raise exception 'Oversize payload accepted'; end if;
end;
$$;
rollback;
