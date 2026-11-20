-- Dedicated QA only. Apply 202610240001, 202610260001, and 202610270001 first; all synthetic rows roll back.
begin;
do $$
declare
  puskesmas jsonb := '{"schemaVersion":1,"date":"2099-06-01","facility":"Synthetic"}';
  edition jsonb := '{"schemaVersion":1,"date":"2099-06-01","edition":{"volume":"Synthetic"}}';
  first_receipt jsonb;
  second_receipt jsonb;
  result jsonb;
begin
  if has_function_privilege('anon', 'public.melinda_daily_documents(text,jsonb)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.melinda_daily_documents(text,jsonb)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.melinda_daily_documents(text,jsonb)', 'EXECUTE') then
    raise exception 'RPC privilege boundary failed';
  end if;
  if has_table_privilege('anon', 'melinda_private.daily_documents', 'SELECT')
    or has_table_privilege('authenticated', 'melinda_private.daily_documents', 'SELECT')
    or has_table_privilege('service_role', 'melinda_private.daily_documents', 'SELECT,INSERT,UPDATE,DELETE') then
    raise exception 'Private table boundary failed';
  end if;

  result := public.melinda_daily_documents('submit', jsonb_build_object('kind','not_a_kind','producerId','qa-bot','key','qa-kind','date','2099-06-01','payloadHash',repeat('a',64),'payload',puskesmas));
  if result->>'errorCode' <> 'invalid_kind' then raise exception 'Unknown kind accepted'; end if;
  result := public.melinda_daily_documents('submit', jsonb_build_object('kind','puskesmas_brief','producerId','qa-bot','key','qa-puskes-bad-date','date','2099-13-01','payloadHash',repeat('a',64),'payload',puskesmas));
  if result->>'errorCode' <> 'invalid_date' then raise exception 'Invalid date accepted'; end if;

  first_receipt := public.melinda_daily_documents('submit', jsonb_build_object('kind','puskesmas_brief','producerId','qa-bot','key','qa-puskes-1','date','2099-06-01','payloadHash',repeat('a',64),'payload',puskesmas));
  if first_receipt->>'replayed' <> 'false' or first_receipt->>'kind' <> 'puskesmas_brief' or first_receipt->>'date' <> '2099-06-01' or first_receipt->>'payloadHash' <> repeat('a',64) then
    raise exception 'Puskesmas receipt missing';
  end if;
  result := public.melinda_daily_documents('submit', jsonb_build_object('kind','puskesmas_brief','producerId','qa-bot','key','qa-puskes-1','date','2099-06-01','payloadHash',repeat('a',64),'payload',puskesmas));
  if result->>'replayed' <> 'true' or result->>'id' <> first_receipt->>'id' then raise exception 'Puskesmas replay failed'; end if;
  result := public.melinda_daily_documents('submit', jsonb_build_object('kind','puskesmas_brief','producerId','qa-bot','key','qa-puskes-1','date','2099-06-01','payloadHash',repeat('b',64),'payload',puskesmas));
  if result->>'errorCode' <> 'conflict' then raise exception 'Puskesmas conflict not detected'; end if;

  perform pg_sleep(0.01);
  second_receipt := public.melinda_daily_documents('submit', jsonb_build_object('kind','puskesmas_brief','producerId','qa-bot','key','qa-puskes-2','date','2099-06-01','payloadHash',repeat('c',64),'payload',puskesmas || '{"facility":"Second"}'));
  result := public.melinda_daily_documents('read', '{"kind":"puskesmas_brief","date":"2099-06-01","lookbackDays":0}');
  if result->'document'->>'id' <> second_receipt->>'id' or result->'document'->>'payload_hash' <> repeat('c',64) then raise exception 'Newest puskesmas revision not served'; end if;
  if (select count(*) from melinda_private.daily_documents where kind = 'puskesmas_brief' and report_date = '2099-06-01') <> 2 then raise exception 'Puskesmas revisions not retained'; end if;
  result := public.melinda_daily_documents('read', '{"kind":"puskesmas_brief","date":"2099-06-02","lookbackDays":0}');
  if result->'document' <> 'null'::jsonb then raise exception 'Puskesmas lookback returned another day'; end if;

  result := public.melinda_daily_documents('read', '{"kind":"news_edition","date":"2099-06-01","lookbackDays":6}');
  if result->'document' <> 'null'::jsonb then raise exception 'Kind isolation failed'; end if;
  result := public.melinda_daily_documents('submit', jsonb_build_object('kind','news_edition','producerId','qa-bot','key','qa-news-1','date','2099-06-01','payloadHash',repeat('d',64),'payload',edition));
  if result->>'replayed' <> 'false' or result->>'kind' <> 'news_edition' then raise exception 'News receipt missing'; end if;
  result := public.melinda_daily_documents('read', '{"kind":"news_edition","date":"2099-06-01","lookbackDays":0}');
  if result->'document'->>'payload_hash' <> repeat('d',64) then raise exception 'News read failed'; end if;
  result := public.melinda_daily_documents('read', '{"kind":"management_brief","date":"2099-06-01","lookbackDays":0}');
  if result->'document' <> 'null'::jsonb then raise exception 'News row leaked into management_brief'; end if;

  result := public.melinda_daily_documents('submit', jsonb_build_object('kind','medify_snapshot','producerId','qa-bot','key','qa-medify-1','date','2099-06-01','payloadHash',repeat('f',64),'payload','{"schemaVersion":1,"date":"2099-06-01"}'::jsonb));
  if result->>'replayed' <> 'false' or result->>'kind' <> 'medify_snapshot' then raise exception 'Medify receipt missing'; end if;
  result := public.melinda_daily_documents('read', '{"kind":"medify_snapshot","date":"2099-06-01","lookbackDays":0}');
  if result->'document'->>'payload_hash' <> repeat('f',64) then raise exception 'Medify read failed'; end if;

  result := public.melinda_daily_documents('submit', jsonb_build_object('kind','news_edition','producerId','qa-bot','key','qa-news-big','date','2099-06-01','payloadHash',repeat('e',64),'payload',jsonb_build_object('blob', repeat('x', 257000))));
  if result->>'errorCode' <> 'invalid_payload' then raise exception 'Oversize news payload accepted'; end if;
end;
$$;
rollback;
