-- Director's official name as set by the Director on 2 Nov 2026.
begin;

update melinda_private.officials
set nama = 'dr. Ferdi Andriska, S.H., M.Kn., CMDC'
where kelompok = 'direktur' and jabatan = 'Direktur';

commit;
