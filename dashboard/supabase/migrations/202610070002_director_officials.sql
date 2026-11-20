begin;

create table melinda_private.officials (
  id smallint generated always as identity primary key,
  kelompok text not null check (kelompok in ('direktur','wadir','kabag')),
  jabatan text not null, nama text not null, urutan smallint not null, aktif boolean not null default true,
  label text generated always as (jabatan || ' – ' || nama) stored check (length(label) <= 60)
);
alter table melinda_private.officials enable row level security;
revoke all on melinda_private.officials from public, anon, authenticated, service_role;

insert into melinda_private.officials (kelompok, jabatan, nama, urutan) values
  ('direktur', 'Direktur', 'dr. Ferdi Iskandar, S.H., M.Kn., CMDC., CLM.', 10),
  ('direktur', 'Staff Khusus Direktur', 'Nurmayatul Handayani, S.Tr.RMIK', 20),
  ('wadir', 'Wadir SDM & Keuangan', 'Widya Putimelinda, S.Psi., M.M.', 30),
  ('wadir', 'Wadir Operasional', 'dr. Novia Dwi Anggraini', 40),
  ('kabag', 'Kepala SDM', 'Oriza Rahmawati, A.Md.Keb.', 50),
  ('kabag', 'Kepala Keuangan', 'Rahayu Wahyuni', 60),
  ('kabag', 'Kabag Pelayanan', 'Amalya Rizki Susanti, A.Md.Keb.', 70),
  ('kabag', 'Kabag Umum', 'Oriza Rahmawati, A.Md.Keb.', 80),
  ('kabag', 'Kabag Penunjang', 'Heri Cahyono', 90);

create function public.melinda_director_officials(command text, args jsonb)
returns jsonb language plpgsql security definer set search_path = ''
set statement_timeout = '5s'
as $$
declare
  result jsonb;
begin
  if command <> 'list' then return jsonb_build_object('errorCode', 'invalid_command'); end if;
  select jsonb_agg(label order by urutan, id) into result from melinda_private.officials where aktif;
  return jsonb_build_object('officials', coalesce(result, '[]'::jsonb));
end;
$$;

revoke all on function public.melinda_director_officials(text, jsonb) from public, anon, authenticated;
grant execute on function public.melinda_director_officials(text, jsonb) to service_role;
comment on function public.melinda_director_officials(text, jsonb) is 'Server-only list of active officials for Director PIC choices.';
commit;
