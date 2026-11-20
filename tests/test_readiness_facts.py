import json
from pathlib import Path

from readiness.facts import full_name, load_facts
from readiness.resolve_facts import resolve_by_fact
from readiness.scan import scan_text

ORG_TABLE = """# Struktur

| Jabatan | Nama | Melapor kepada |
| --- | --- | --- |
| Direktur | dr. Ferdi Andriska, S.H., M.Kn., CMDC | Pemilik |
| Wakil Direktur Operasional | dr. Novia Dwi Anggraini (bagan: dr. Novi Di Anggraini) | Direktur |
| Farmasi | apt. Siska Ayu Wardani | Kepala Bagian Penunjang |

Teks lain.
"""

CSV = """No,Nama Lengkap,Gelar,Jabatan,Status,Departemen,Lama Kerja
1,Ferdi Andriska,"dr., S.H., M.Kn., CMDC., CLM",Direktur Utama,Tetap,Direksi,10 thn
2,Widya Putri Melinda,"S.Psi., M.M.",WADIR SDM & Keuangan,Tetap,Direksi,8 thn
3,Achmad Sholeh,A.Md.AK,Kepala Laboratorium,Tetap,Penunjang,3 thn
"""


def make_root(tmp_path: Path, nursing_status: str = "verified") -> Path:
    (tmp_path / "dashboard/data/studio").mkdir(parents=True)
    (tmp_path / "knowledge/01_HOSPITAL/governance").mkdir(parents=True)
    (tmp_path / "knowledge/11_MACHINE_READABLE/manifest").mkdir(parents=True)
    (tmp_path / "dashboard/data/studio/facts.json").write_text(json.dumps([
        {"key": "director.name", "value": "dr. Ferdi Andriska, S.H., M.Kn., CMDC", "status": "verified"},
        {"key": "nursing.head", "value": "Amalya Rizki Susanti, A.Md.Keb.", "status": nursing_status},
    ]), encoding="utf-8")
    (tmp_path / "knowledge/01_HOSPITAL/governance/kb-manajemen-struktur-organisasi-rs.md").write_text(ORG_TABLE, encoding="utf-8")
    (tmp_path / "knowledge/11_MACHINE_READABLE/manifest/employees_2026.csv").write_text(CSV, encoding="utf-8")
    return tmp_path


def one(line: str):
    return scan_text("d.md", line)[0]


def test_load_facts_precedence_and_sources(tmp_path: Path):
    facts = load_facts(make_root(tmp_path))
    assert facts["director.name"] == "dr. Ferdi Andriska, S.H., M.Kn., CMDC"
    assert facts["nursing.head"] == "Amalya Rizki Susanti, A.Md.Keb."
    assert facts["role:wakil direktur operasional"] == "dr. Novia Dwi Anggraini"
    assert facts["role:farmasi"] == "apt. Siska Ayu Wardani"
    assert facts["employee:widya putri melinda"] == "Widya Putri Melinda, S.Psi., M.M."
    assert facts["role:kepala laboratorium"] == "Achmad Sholeh, A.Md.AK"


def test_full_name_assembles_prefix_and_suffix_titles():
    assert full_name("Ferdi Andriska", "dr., S.H., M.Kn., CMDC., CLM") == "dr. Ferdi Andriska, S.H., M.Kn., CMDC., CLM"
    assert full_name("Siska Ayu Wardani", "Apt., S.Farm.") == "Apt. Siska Ayu Wardani, S.Farm."
    assert full_name("Sukemi", "") == "Sukemi"


def test_nursing_head_resolves_from_verified_fact(tmp_path: Path):
    facts = load_facts(make_root(tmp_path))
    line = "Penanggung jawab: Kepala Keperawatan [ISI]"
    fill = resolve_by_fact(one(line), line, facts)
    assert fill is not None
    assert fill.value == "Amalya Rizki Susanti, A.Md.Keb."
    assert fill.method == "fact"
    assert fill.source_ref == "dashboard/data/studio/facts.json#nursing.head"


def test_director_resolves(tmp_path: Path):
    facts = load_facts(make_root(tmp_path))
    line = "| Ditetapkan oleh | Direktur [ISI] |"
    fill = resolve_by_fact(one(line), line, facts)
    assert fill is not None and fill.value == "dr. Ferdi Andriska, S.H., M.Kn., CMDC"


def test_unverified_fact_is_ignored(tmp_path: Path):
    facts = load_facts(make_root(tmp_path, nursing_status="draft"))
    assert "nursing.head" not in facts
    line = "Kepala Keperawatan [ISI]"
    assert resolve_by_fact(one(line), line, facts) is None


def test_unknown_role_cek_and_consumed_role_return_none(tmp_path: Path):
    facts = load_facts(make_root(tmp_path))
    line = "Kepala unit pendaftaran [ISI]"
    assert resolve_by_fact(one(line), line, facts) is None
    line = "Direktur [CEK]"
    assert resolve_by_fact(one(line), line, facts) is None
    line = "| Disusun oleh | Direktur [CEK] | [ISI] | [ISI] |"
    items = scan_text("d.md", line)
    assert resolve_by_fact(items[1], line, facts) is not None  # name column
    assert resolve_by_fact(items[2], line, facts) is None  # signature column: role already consumed
