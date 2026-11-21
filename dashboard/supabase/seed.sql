-- Dummy data for a local or disposable database. Every row is invented: no real person, patient, facility or
-- document. Apply it after the migrations:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/seed.sql
-- It is safe to run twice: each call carries its own idempotency key and the schedule is replaced, not appended.
-- scripts/db-test.sh applies it twice after the acceptance tests, so it stays valid against the current schema.
-- Never run it against the hospital's production project.
begin;
do $$
declare
  r jsonb;
begin
  -- One Director instruction on a fictional report date.
  r := public.melinda_director_instructions('create', jsonb_build_object(
    'reviewerId', 'seed-reviewer', 'key', 'seed-instruction-0001', 'requestHash', repeat('5', 64),
    'reportDate', '2099-01-01', 'section', 'priorities', 'itemId', 'seed-p1',
    'itemTitle', 'CONTOH: tinjau jadwal jaga (data fiktif)', 'urgent', false, 'action', 'request_update',
    'deadline', '2099-01-02T16:00', 'pic', '[]'::jsonb, 'note', 'Data contoh, bukan instruksi nyata.'));
  if r ? 'errorCode' then raise exception 'Seed instruction failed: %', r; end if;

  -- Two agenda items for the same fictional day.
  r := public.melinda_director_tasks('schedule_replace', jsonb_build_object(
    'date', '2099-01-01', 'producer', 'seed', 'items', jsonb_build_array(
      jsonb_build_object('start', '08:00', 'end', '09:00', 'title', 'CONTOH: apel pagi', 'place', 'Aula', 'pic', '["Petugas Contoh"]'::jsonb),
      jsonb_build_object('start', '13:00', 'end', null, 'title', 'CONTOH: rapat koordinasi', 'place', null, 'pic', '[]'::jsonb))));
  if r ? 'errorCode' then raise exception 'Seed schedule failed: %', r; end if;

  -- One referral from a fictional clinic for a fictional patient.
  r := public.melinda_referrals('submit', jsonb_build_object('key', 'seed-referral-0001', 'payload', jsonb_build_object(
    'patient', jsonb_build_object('name', 'Pasien Contoh', 'birthDate', '1990-01-01', 'age', '', 'sex', 'P', 'rm', '', 'nik', ''),
    'referrer', jsonb_build_object('facilityType', 'Klinik', 'facility', 'Klinik Contoh', 'city', 'Kota Contoh',
      'doctor', 'dr. Contoh', 'phone', '080000000000', 'sip', ''),
    'clinical', jsonb_build_object(
      'profileId', 'hipertensi_dewasa', 'diagnosis', 'Hipertensi', 'reason', 'Kontrol tekanan darah', 'onset', '3 hari',
      'vitals', jsonb_build_object('td', '160/100'), 'checks', '{}'::jsonb, 'therapy', '', 'allergy', '',
      'pregnancy', '', 'insurer', 'BPJS Kesehatan', 'destination', 'Poli Penyakit Dalam', 'date', '2099-01-01',
      'time', '09:30', 'notes', 'Data contoh.'),
    'consent', true)));
  if r ? 'errorCode' then raise exception 'Seed referral failed: %', r; end if;
end $$;
commit;
