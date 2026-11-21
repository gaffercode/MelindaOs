#!/usr/bin/env sh
# Apply every Supabase migration to an empty PostgreSQL database and run the SQL acceptance tests.
# Used by CI (service container) and locally: DATABASE_URL=postgres://... dashboard/scripts/db-test.sh
# Never point this at the hospital's production database: the tests insert and roll back synthetic rows,
# but the migrations must run on an empty schema.
set -eu
cd "$(dirname "$0")/.."
: "${DATABASE_URL:?DATABASE_URL (an empty PostgreSQL database) is required}"
export PGOPTIONS="-c client_min_messages=warning"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q <<'SQL'
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
SQL
for file in supabase/migrations/*.sql; do
  echo "migration: $file"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$file"
done
status=0
for file in supabase/tests/*.sql; do
  if psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$file"; then echo "PASS $file"; else echo "FAIL $file"; status=1; fi
done
if [ "$status" -eq 0 ]; then
  if node scripts/db-test-concurrency.mjs; then echo "PASS two-connection concurrency"; else echo "FAIL two-connection concurrency"; status=1; fi
fi
if [ "$status" -eq 0 ]; then
  # The dummy seed (invented rows only) must stay valid against the current schema and be safe to run twice.
  if psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f supabase/seed.sql && psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f supabase/seed.sql; then
    echo "PASS dummy seed (applied twice)"
  else
    echo "FAIL dummy seed"; status=1
  fi
fi
exit $status
