#!/usr/bin/env python3
"""
RSIA Melinda DHAI Kediri - STARKES Automated Document Generator CLI Bridge
Connects the STARKES Assessment Elements (EP) to the ReportLab document compilers
(SK Direktur and SPO Universal).

Usage:
    uv run python tools/doc_generator/cli_runner.py --ep-id "47104-2024:TKRS:1:1"
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

_TOOLS_DIR = Path(__file__).resolve().parents[1]
_ROOT_DIR = _TOOLS_DIR.parent
if str(_TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(_TOOLS_DIR))

from _paths import repo  # noqa: E402
from doc_generator.generate_sk_direktur import build_sk_pdf  # noqa: E402
from doc_generator.generate_spo import build_two_pass_pdf, parse_markdown_blocks  # noqa: E402

REQUIREMENTS_FILE = _ROOT_DIR / "dashboard" / "data" / "starkes" / "requirements.json"
DEFAULT_OUTPUT_DIR = _ROOT_DIR / "dashboard" / "public" / "generated" / "starkes"


def clean_ep_id(ep_id: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_\-\.]", "_", ep_id)


def load_ep(ep_id: str) -> dict:
    if not REQUIREMENTS_FILE.exists():
        raise FileNotFoundError(f"Requirements database not found at {REQUIREMENTS_FILE}")
    with open(REQUIREMENTS_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)
    for req in data.get("requirements", []):
        if req.get("id") == ep_id:
            return req
    raise KeyError(f"EP ID '{ep_id}' not found in STARKES requirements catalog.")


def decide_doc_type(ep: dict, requested_type: str = "auto") -> str:
    if requested_type in ("sk", "spo"):
        return requested_type.upper()
    
    chapter = ep.get("chapterCode", "")
    text = ep.get("text", "").lower()
    
    # Governance, staffing appointments, and high-level hospital bylaws require SK Direktur
    if chapter in ("TKRS", "KPS") or any(k in text for k in ["ditetapkan oleh", "dewan pengawas", "pedoman pengorganisasian", "kebijakan", "pemilik"]):
        return "SK"
    return "SPO"


def generate_for_ep(ep_id: str, doc_type: str = "auto", output_path: Path | None = None, dry_run: bool = False) -> dict:
    ep = load_ep(ep_id)
    resolved_type = decide_doc_type(ep, doc_type)
    ep_safe = clean_ep_id(ep_id)
    
    if output_path is None:
        DEFAULT_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        output_path = DEFAULT_OUTPUT_DIR / f"{ep_safe}_{resolved_type.lower()}.pdf"
    else:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        
    std_code = ep.get("standardCode", "")
    ep_code = ep.get("epCode", "")
    ep_text = ep.get("text", "").rstrip(".")
    
    if resolved_type == "SK":
        nomor_sk = f"SK-DIR/{ep.get('chapterCode', 'MED')}/2026/{ep_code.zfill(3)}"
        tentang = f"Pemberlakuan Regulasi {std_code} Elemen Penilaian {ep_code}: {ep_text}"
        menimbang = [
            f"bahwa dalam rangka menjamin kepatuhan terhadap standar akreditasi rumah sakit (STARKES {std_code}), diperlukan regulasi tata kelola yang terstandarisasi;",
            f"bahwa pelaksanaan {ep_text} harus memiliki landasan hukum yang mengikat bagi seluruh civitas hospitalia RSIA Melinda DHAI;",
            "bahwa berdasarkan pertimbangan tersebut, perlu ditetapkan Keputusan Direktur RSIA Melinda DHAI.",
        ]
        mengingat = [
            "Undang-Undang Nomor 17 Tahun 2023 tentang Kesehatan;",
            "Peraturan Menteri Kesehatan Republik Indonesia Nomor 6 Tahun 2026 tentang Akreditasi Rumah Sakit;",
            "Keputusan Menteri Kesehatan RI Nomor HK.01.07/MENKES/1128/2022 tentang Standar Akreditasi Rumah Sakit (STARKES);",
            "Peraturan Internal Rumah Sakit (Hospital Bylaws) RSIA Melinda DHAI Kediri.",
        ]
        diktum = [
            ("KESATU", f"Memberlakukan kebijakan dan regulasi terkait {ep_text} di lingkungan RSIA Melinda DHAI Kediri."),
            ("KEDUA", "Regulasi sebagaimana dimaksud pada Diktum KESATU menjadi pedoman baku bagi unit kerja dan wajib dipatuhi oleh seluruh jajaran manajemen dan tenaga medis."),
            ("KETIGA", "Keputusan ini berlaku sejak tanggal ditetapkan, dan apabila di kemudian hari terdapat kekeliruan akan dilakukan perbaikan sebagaimana mestinya."),
        ]
        
        if not dry_run:
            build_sk_pdf(
                output_path=output_path,
                nomor_sk=nomor_sk,
                tentang=tentang,
                menimbang=menimbang,
                mengingat=mengingat,
                diktum=diktum,
            )
            
        return {
            "success": True,
            "epId": ep_id,
            "chapter": ep.get("chapterCode"),
            "docType": "SK",
            "nomor": nomor_sk,
            "title": tentang,
            "pdfPath": str(output_path),
            "filename": output_path.name,
            "url": f"/generated/starkes/{output_path.name}",
            "dryRun": dry_run,
        }
        
    else:  # SPO
        nomor_spo = f"SPO/{ep.get('chapterCode', 'MED')}/2026/{ep_code.zfill(3)}"
        judul = f"Standar Prosedur Operasional {std_code} EP {ep_code}: {ep_text}"
        
        spec = {
            "title": judul,
            "jenis": "Standar Prosedur Operasional",
            "nomor": nomor_spo,
            "header": f"RSIA Melinda DHAI - {std_code}",
        }
        
        spo_markdown = f"""
# 1. PENGERTIAN
{ep_text} adalah serangkaian tata laksana klinis dan administratif yang baku di lingkungan RSIA Melinda DHAI guna memastikan kepatuhan pelayanan terhadap standar mutu dan keselamatan pasien.

# 2. TUJUAN
Sebagai acuan penerapan langkah-langkah bagi seluruh tenaga kesehatan dan petugas penunjang dalam melaksanakan {ep_text} secara konsisten, aman, dan terdokumentasi.

# 3. KEBIJAKAN
Surat Keputusan Direktur RSIA Melinda DHAI tentang Kebijakan Mutu dan Pelayanan Pasien Rumah Sakit.

# 4. PROSEDUR
1. Petugas melakukan identifikasi kebutuhan dan verifikasi berkas pasien sesuai prosedur keselamatan pasien.
2. Petugas menjelaskan maksud dan tujuan tindakan kepada pasien atau keluarga pasien.
3. Pelaksanaan tindakan dilakukan sesuai dengan panduan klinis dan standar operasional yang berlaku.
4. Petugas mendokumentasikan setiap tahapan pelaksanaan pada rekam medis atau formulir bukti kepatuhan yang tersedia.
5. Unit kerja melakukan evaluasi kepatuhan secara berkala dan melaporkan hasilnya kepada Komite Mutu & Keselamatan Pasien (KMKP).

# 5. UNIT TERKAIT
- Unit Gawat Darurat & Rawat Jalan
- Unit Rawat Inap & Kamar Bersalin
- Instalasi Farmasi & Laboratorium
- Komite Mutu & Keselamatan Pasien (KMKP)
"""
        blocks = parse_markdown_blocks(spo_markdown)
        if not dry_run:
            build_two_pass_pdf(output_path=output_path, spec=spec, blocks=blocks, logo_path=None)
            
        return {
            "success": True,
            "epId": ep_id,
            "chapter": ep.get("chapterCode"),
            "docType": "SPO",
            "nomor": nomor_spo,
            "title": judul,
            "pdfPath": str(output_path),
            "filename": output_path.name,
            "url": f"/generated/starkes/{output_path.name}",
            "dryRun": dry_run,
        }


def main():
    parser = argparse.ArgumentParser(description="STARKES Automated Document Generator CLI Bridge")
    parser.add_argument("--ep-id", required=True, help="STARKES EP ID (e.g. 47104-2024:TKRS:1:1)")
    parser.add_argument("--type", choices=["auto", "sk", "spo"], default="auto", help="Document type to generate")
    parser.add_argument("--out", help="Optional output PDF destination path")
    parser.add_argument("--dry-run", action="store_true", help="Perform validation without compiling PDF")
    
    args = parser.parse_args()
    
    try:
        out_path = Path(args.out) if args.out else None
        result = generate_for_ep(args.ep_id, doc_type=args.type, output_path=out_path, dry_run=args.dry_run)
        print(json.dumps(result, indent=2))
        sys.exit(0)
    except Exception as exc:
        print(json.dumps({"success": False, "error": str(exc)}), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
