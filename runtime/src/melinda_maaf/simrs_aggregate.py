"""Turn a Medify aggregate export into a dashboard census snapshot.

The export is counts only. A column or value that carries a patient identity
is rejected and nothing is written.
"""

from __future__ import annotations

import csv
import io
import json
import os
import re
import urllib.request
from pathlib import Path
from typing import Any

ALLOWED: dict[tuple[str, str], str] = {
    ("rawat_inap", "terisi"): "rawat_inap_terisi",
    ("rawat_inap", "kapasitas"): "rawat_inap_kapasitas",
    ("rawat_inap", "masuk"): "rawat_inap_masuk",
    ("rawat_inap", "pulang"): "rawat_inap_pulang",
    ("kamar_bersalin", "persalinan"): "persalinan",
    ("kamar_bersalin", "bayi"): "bayi",
    ("rawat_jalan", "registrasi"): "registrasi_poli",
    ("farmasi", "resep"): "resep",
    ("bpjs", "sep"): "sep",
}

FORBIDDEN_HEADERS = {
    "nama",
    "nik",
    "no_rm",
    "norm",
    "rm",
    "rekam_medis",
    "telepon",
    "hp",
    "alamat",
    "email",
    "pasien",
    "diagnosa",
    "ktp",
}

DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
TIME_RE = re.compile(r"^(\d{2})\.(\d{2})$|^(\d{2}):(\d{2})$")
MAX_EXPORT_BYTES = 1_000_000


class SimrsAggregateError(ValueError):
    """The export cannot be turned into a census snapshot."""


def _key(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", value.strip().lower()).strip("_")


def rows_from_csv(text: str) -> list[dict[str, str]]:
    reader = csv.DictReader(io.StringIO(text))
    if reader.fieldnames is None:
        raise SimrsAggregateError("Berkas CSV tidak punya baris judul.")
    headers = [_key(name) for name in reader.fieldnames if name]
    blocked = sorted(set(headers) & FORBIDDEN_HEADERS)
    if blocked:
        raise SimrsAggregateError(f"Kolom identitas tidak diterima: {', '.join(blocked)}.")
    required = {"tanggal", "jam", "kelompok", "indikator", "nilai"}
    missing = sorted(required - set(headers))
    if missing:
        raise SimrsAggregateError(f"Kolom wajib belum ada: {', '.join(missing)}.")
    rows: list[dict[str, str]] = []
    for raw in reader:
        rows.append({_key(key): (value or "").strip() for key, value in raw.items() if key})
    return rows


def rows_from_json(text: str) -> list[dict[str, str]]:
    try:
        payload = json.loads(text)
    except json.JSONDecodeError as error:
        raise SimrsAggregateError("Berkas JSON tidak dapat dibaca.") from error
    if not isinstance(payload, list):
        raise SimrsAggregateError("JSON harus berupa daftar baris agregat.")
    rows: list[dict[str, str]] = []
    for item in payload:
        if not isinstance(item, dict):
            raise SimrsAggregateError("Setiap baris JSON harus berupa objek.")
        blocked = sorted(FORBIDDEN_HEADERS & {_key(str(key)) for key in item})
        if blocked:
            raise SimrsAggregateError(f"Kolom identitas tidak diterima: {', '.join(blocked)}.")
        rows.append({_key(str(key)): str(value).strip() if value is not None else "" for key, value in item.items()})
    if rows and not {"tanggal", "jam", "kelompok", "indikator", "nilai"} <= set(rows[0]):
        raise SimrsAggregateError("JSON wajib memuat tanggal, jam, kelompok, indikator, dan nilai.")
    return rows


def _clock(value: str) -> tuple[int, int]:
    match = TIME_RE.fullmatch(value.strip())
    if match is None:
        raise SimrsAggregateError(f"Jam tidak dikenali: {value!r}. Pakai 07.30 atau 07:30.")
    hour = int(match.group(1) or match.group(3))
    minute = int(match.group(2) or match.group(4))
    if hour > 23 or minute > 59:
        raise SimrsAggregateError(f"Jam tidak dikenali: {value!r}.")
    return hour, minute


def _count(value: str) -> int | None:
    if value == "":
        return None
    if not re.fullmatch(r"\d+", value):
        raise SimrsAggregateError(f"Nilai harus bilangan bulat, bukan {value!r}.")
    return int(value)


def _note(value: str) -> str:
    if "@" in value or re.search(r"\d{8,}", value):
        raise SimrsAggregateError("Catatan berisi identitas atau nomor panjang dan ditolak.")
    return value[:200]


def snapshots_from_rows(rows: list[dict[str, str]], source_name: str) -> list[dict[str, Any]]:
    grouped: dict[str, dict[str, Any]] = {}
    for row in rows:
        date = row.get("tanggal", "")
        if date == "" and row.get("nilai", "") == "":
            continue
        if not DATE_RE.fullmatch(date):
            raise SimrsAggregateError(f"Tanggal wajib YYYY-MM-DD, dapat {date!r}.")
        indicator = ALLOWED.get((row.get("kelompok", ""), row.get("indikator", "")))
        if indicator is None:
            raise SimrsAggregateError(
                f"Kelompok/indikator tidak dikenal: {row.get('kelompok', '')}/{row.get('indikator', '')}."
            )
        count = _count(row.get("nilai", ""))
        if count is None:
            continue
        hour, minute = _clock(row.get("jam", ""))
        bucket = grouped.setdefault(date, {"counts": {}, "minutes": -1, "notes": []})
        bucket["counts"][indicator] = count
        minutes = hour * 60 + minute
        if minutes >= bucket["minutes"]:
            bucket["minutes"] = minutes
            bucket["clock"] = f"{hour:02d}.{minute:02d}"
        note = _note(row.get("catatan", ""))
        if note:
            bucket["notes"].append(note)
    snapshots: list[dict[str, Any]] = []
    for date, bucket in sorted(grouped.items()):
        if not bucket["counts"]:
            continue
        snapshots.append(_snapshot(date, bucket, source_name))
    return snapshots


def _nilai(counts: dict[str, int], key: str, unit: str) -> str:
    value = counts.get(key)
    if value is None:
        return "Sumber tidak tersedia"
    return f"{value} {unit}"


def _inpatient_nilai(counts: dict[str, int]) -> str:
    occupied = counts.get("rawat_inap_terisi")
    capacity = counts.get("rawat_inap_kapasitas")
    if occupied is None:
        return "Sumber tidak tersedia"
    if capacity is None or capacity == 0 or occupied > capacity:
        return f"{occupied} tempat tidur terisi"
    bor = (occupied * 100 + capacity // 2) // capacity
    return f"{occupied} / {capacity} tempat tidur · BOR {bor}%"


def _inpatient_note(counts: dict[str, int]) -> str:
    parts = ["Diisi dari ekspor agregat Medify."]
    occupied = counts.get("rawat_inap_terisi")
    capacity = counts.get("rawat_inap_kapasitas")
    if occupied is not None and capacity is not None and occupied > capacity:
        parts.append("Terisi melebihi kapasitas. Periksa berkas ekspor.")
    if "rawat_inap_masuk" in counts:
        parts.append(f"Masuk {counts['rawat_inap_masuk']}.")
    if "rawat_inap_pulang" in counts:
        parts.append(f"Pulang {counts['rawat_inap_pulang']}.")
    return " ".join(parts)


def _metric(kategori: str, indikator: str, nilai: str, catatan: str) -> dict[str, str]:
    return {
        "kategori": kategori,
        "indikator": indikator,
        "nilai": nilai,
        "statusBadge": "INFO",
        "catatan": catatan,
    }


def _snapshot(date: str, bucket: dict[str, Any], source_name: str) -> dict[str, Any]:
    counts: dict[str, int] = bucket["counts"]
    clock = bucket["clock"]
    base = "Diisi dari ekspor agregat Medify."
    return {
        "tanggal": date,
        "diamatiPada": f"{date}T{clock.replace('.', ':')}:00+07:00",
        "sumber": "Ekspor agregat Medify",
        "berkas": source_name,
        "headerRight": f"MEDIFY · EKSPOR {clock} WIB",
        "syncStatus": f"Ekspor agregat {clock} WIB",
        "catatan": f"Angka diisi dari berkas {source_name} pukul {clock} WIB. Bukan sesi layar Medify.",
        "metrics": [
            _metric("RAWAT INAP", "Sensus Pasien Aktif & BOR", _inpatient_nilai(counts), _inpatient_note(counts)),
            _metric("KAMAR BERSALIN", "Persalinan (VK) & Bayi (Perina)", _birth_nilai(counts), base),
            _metric("RAWAT JALAN", "Registrasi Antrean Poliklinik", _nilai(counts, "registrasi_poli", "kunjungan"), base),
            _metric("FARMASI", "Resep Terlayani & Kecepatan", _nilai(counts, "resep", "resep"), base),
            _metric("BPJS & KLAIM", "Bridging VClaim & Status SEP", _nilai(counts, "sep", "SEP"), base),
            _metric(
                "INTEGRASI MEDIFY",
                "Konektivitas SIMRS Melinda",
                "Ekspor agregat masuk",
                "Berkas diimpor ke dasbor. Login layar Medify tidak dipakai.",
            ),
        ],
    }


def _birth_nilai(counts: dict[str, int]) -> str:
    births = counts.get("persalinan")
    babies = counts.get("bayi")
    if births is None and babies is None:
        return "Sumber tidak tersedia"
    parts: list[str] = []
    if births is not None:
        parts.append(f"{births} persalinan")
    if babies is not None:
        parts.append(f"{babies} bayi")
    return " · ".join(parts)


def write_snapshots(snapshots: list[dict[str, Any]], out_dir: Path) -> list[Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []
    for snapshot in snapshots:
        target = out_dir / f"{snapshot['tanggal']}.json"
        temporary = target.with_suffix(".json.tmp")
        temporary.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        os.replace(temporary, target)
        written.append(target)
    return written


def import_export(source: Path, out_dir: Path) -> list[Path]:
    if not source.is_file():
        raise SimrsAggregateError(f"Berkas tidak ditemukan: {source}")
    if source.stat().st_size > MAX_EXPORT_BYTES:
        raise SimrsAggregateError("Berkas ekspor terlalu besar untuk laporan agregat.")
    text = source.read_text(encoding="utf-8-sig")
    rows = rows_from_json(text) if source.suffix.lower() == ".json" else rows_from_csv(text)
    snapshots = snapshots_from_rows(rows, source.name)
    if not snapshots:
        raise SimrsAggregateError("Tidak ada angka agregat untuk ditulis.")
    return write_snapshots(snapshots, out_dir)


def pull_export(url: str, dest: Path, token: str | None = None) -> Path:
    if not url.startswith("https://"):
        raise SimrsAggregateError("Tarikan hanya menerima URL https.")
    request = urllib.request.Request(url, headers={"Accept": "text/csv, application/json"})
    if token:
        request.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            payload = response.read(MAX_EXPORT_BYTES + 1)
    except OSError as error:
        raise SimrsAggregateError("Tarikan ekspor gagal. Periksa URL dan jaringan rumah sakit.") from error
    if len(payload) > MAX_EXPORT_BYTES:
        raise SimrsAggregateError("Berkas ekspor terlalu besar untuk laporan agregat.")
    preview = payload[:500].lower()
    if b"<html" in preview or payload.startswith(b"\xff\xd8") or payload.startswith(b"%pdf"):
        raise SimrsAggregateError("URL mengembalikan halaman atau dokumen, bukan CSV/JSON agregat.")
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(payload)
    return dest


def main(argv: list[str] | None = None) -> int:
    import argparse

    repo = Path(__file__).resolve().parents[3]
    parser = argparse.ArgumentParser(description="Impor ekspor agregat Medify ke snapshot sensus dasbor.")
    parser.add_argument("source", nargs="?", type=Path, help="Berkas CSV atau JSON agregat.")
    parser.add_argument("--pull", action="store_true", help="Unduh MELINDAOS_SIMRS_EXPORT_URL lalu impor.")
    parser.add_argument("--out-dir", type=Path, default=repo / "dashboard" / "data" / "simrs")
    args = parser.parse_args(argv)
    source = args.source
    try:
        if args.pull:
            url = os.environ.get("MELINDAOS_SIMRS_EXPORT_URL", "").strip()
            if not url:
                raise SimrsAggregateError("MELINDAOS_SIMRS_EXPORT_URL belum diisi.")
            inbox = args.out_dir / "inbox"
            source = pull_export(url, inbox / "medify-export.csv", os.environ.get("MELINDAOS_SIMRS_EXPORT_TOKEN"))
        if source is None:
            raise SimrsAggregateError("Sebut berkas CSV/JSON, atau pakai --pull.")
        written = import_export(source, args.out_dir)
    except SimrsAggregateError as error:
        print(error)
        return 1
    for path in written:
        print(path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
