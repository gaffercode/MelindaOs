import json
from pathlib import Path

import pytest

from melinda_maaf.simrs_aggregate import SimrsAggregateError, import_export

CSV = """tanggal,jam,kelompok,indikator,nilai,catatan
2026-10-25,07.30,rawat_inap,terisi,28,
2026-10-25,07.30,rawat_inap,kapasitas,42,
2026-10-25,07.30,rawat_inap,masuk,3,
2026-10-25,07.30,kamar_bersalin,persalinan,4,
2026-10-25,07.30,kamar_bersalin,bayi,7,
2026-10-25,07.30,rawat_jalan,registrasi,64,
2026-10-25,07.30,farmasi,resep,112,
2026-10-25,07:30,bpjs,sep,46,
"""


def test_import_writes_census_snapshot(tmp_path: Path) -> None:
    source = tmp_path / "sensus.csv"
    source.write_text(CSV, encoding="utf-8")
    written = import_export(source, tmp_path / "out")
    snapshot = json.loads(written[0].read_text(encoding="utf-8"))
    assert written[0].name == "2026-10-25.json"
    assert snapshot["headerRight"] == "MEDIFY · EKSPOR 07.30 WIB"
    inpatient = snapshot["metrics"][0]
    assert inpatient["nilai"] == "28 / 42 tempat tidur · BOR 67%"
    assert "Masuk 3." in inpatient["catatan"]
    assert snapshot["metrics"][1]["nilai"] == "4 persalinan · 7 bayi"
    assert snapshot["metrics"][4]["nilai"] == "46 SEP"


def test_import_rejects_patient_identity(tmp_path: Path) -> None:
    source = tmp_path / "pasien.csv"
    source.write_text("tanggal,jam,kelompok,indikator,nilai,nama\n2026-10-25,07.30,rawat_inap,terisi,1,A\n", encoding="utf-8")
    with pytest.raises(SimrsAggregateError, match="identitas"):
        import_export(source, tmp_path / "out")
    assert not (tmp_path / "out" / "2026-10-25.json").exists()


def test_import_rejects_non_numeric_value(tmp_path: Path) -> None:
    source = tmp_path / "teks.csv"
    source.write_text("tanggal,jam,kelompok,indikator,nilai\n2026-10-25,07.30,rawat_inap,terisi,dua puluh\n", encoding="utf-8")
    with pytest.raises(SimrsAggregateError, match="bilangan"):
        import_export(source, tmp_path / "out")
