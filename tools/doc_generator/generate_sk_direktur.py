#!/usr/bin/env python3
"""
RSIA Melinda DHAI Kediri - Automated SK Direktur Generator
Mengompilasi Surat Keputusan Direktur berformat hukum resmi:
Kop resmi, Konsiderans (Menimbang, Mengingat Permenkes 6/2026 & UU 17/2023), Diktum Memutuskan,
dan Pengesahan oleh Direktur dr. Ferdi Andriska, S.H., M.Kn., CMDC
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

_TOOLS_DIR = Path(__file__).resolve().parents[1]
if str(_TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(_TOOLS_DIR))

from _paths import first_font, repo  # noqa: E402

from reportlab.lib.colors import HexColor
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    Image,
    KeepTogether,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)

try:
    pdfmetrics.registerFont(TTFont("Calibri", str(first_font("Calibri-Regular.ttf", "calibri.ttf"))))
    pdfmetrics.registerFont(TTFont("Calibri-Bold", str(first_font("Calibri-Bold.ttf", "calibrib.ttf"))))
    pdfmetrics.registerFont(TTFont("Calibri-Italic", str(first_font("Calibri-Italic.ttf", "calibrii.ttf"))))
    FONT_NORMAL = "Calibri"
    FONT_BOLD = "Calibri-Bold"
    FONT_ITALIC = "Calibri-Italic"
except Exception:
    FONT_NORMAL = "Helvetica"
    FONT_BOLD = "Helvetica-Bold"
    FONT_ITALIC = "Helvetica-Oblique"

MAROON = HexColor("#6B2340")
INK = HexColor("#1E2430")
MUTED = HexColor("#5E6670")
GOLD = HexColor("#B8956A")

PAGE_W, PAGE_H = A4
LEFT_MARGIN = 18 * mm
RIGHT_MARGIN = 18 * mm
CONTENT_W = PAGE_W - LEFT_MARGIN - RIGHT_MARGIN
SIGNATORY = "dr. Ferdi Andriska, S.H., M.Kn., CMDC"


def get_styles() -> dict[str, ParagraphStyle]:
    return {
        "kicker": ParagraphStyle(
            "kicker", fontName=FONT_BOLD, fontSize=8, leading=10, textColor=MAROON, alignment=TA_CENTER
        ),
        "hospital": ParagraphStyle(
            "hospital", fontName=FONT_BOLD, fontSize=15, leading=18, textColor=MAROON, alignment=TA_CENTER
        ),
        "sub": ParagraphStyle(
            "sub", fontName=FONT_NORMAL, fontSize=8.5, leading=11, textColor=INK, alignment=TA_CENTER
        ),
        "addr": ParagraphStyle(
            "addr", fontName=FONT_NORMAL, fontSize=8, leading=10, textColor=MUTED, alignment=TA_CENTER
        ),
        "sk_title": ParagraphStyle(
            "sk_title", fontName=FONT_BOLD, fontSize=11, leading=14, textColor=INK, alignment=TA_CENTER
        ),
        "sk_tentang": ParagraphStyle(
            "sk_tentang", fontName=FONT_BOLD, fontSize=10.5, leading=13.5, textColor=MAROON, alignment=TA_CENTER
        ),
        "konsiderans_h": ParagraphStyle(
            "konsiderans_h", fontName=FONT_BOLD, fontSize=9.5, leading=12.5, textColor=INK, alignment=TA_LEFT
        ),
        "body": ParagraphStyle(
            "body", fontName=FONT_NORMAL, fontSize=9, leading=12.5, textColor=INK, alignment=TA_JUSTIFY, spaceAfter=3
        ),
        "body_bold": ParagraphStyle(
            "body_bold", fontName=FONT_BOLD, fontSize=9, leading=12.5, textColor=INK, alignment=TA_LEFT
        ),
        "sig": ParagraphStyle(
            "sig", fontName=FONT_NORMAL, fontSize=9, leading=12, textColor=INK, alignment=TA_CENTER
        ),
        "sig_name": ParagraphStyle(
            "sig_name", fontName=FONT_BOLD, fontSize=9.5, leading=12, textColor=INK, alignment=TA_CENTER
        ),
    }


S = get_styles()


def build_sk_pdf(
    output_path: Path,
    nomor_sk: str,
    tentang: str,
    menimbang: list[str],
    mengingat: list[str],
    diktum: list[tuple[str, str]],
    logo_path: Path | None = None,
):
    output_path.parent.mkdir(parents=True, exist_ok=True)

    # 1. Kop Surat
    kop_text = [
        Paragraph("RUMAH SAKIT IBU DAN ANAK", S["kicker"]),
        Paragraph("RSIA MELINDA DHAI", S["hospital"]),
        Paragraph("KOTA KEDIRI — JAWA TIMUR", S["sub"]),
        Paragraph("Jl. Balowerti II No. 59, Balowerti, Kota Kediri 64129 | Telp. (0354) 691016", S["addr"]),
    ]

    logo_col = []
    if logo_path and logo_path.exists():
        logo_col = [Image(str(logo_path), width=20 * mm, height=20 * mm)]
    else:
        logo_col = [""]

    kop_table = Table(
        [[logo_col[0], kop_text, ""]],
        colWidths=[24 * mm, CONTENT_W - 48 * mm, 24 * mm],
    )
    kop_table.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
                ("LINEBELOW", (0, 0), (-1, -1), 1.5, MAROON),
            ]
        )
    )

    # 2. Judul SK
    header_flow = [
        Spacer(1, 3 * mm),
        Paragraph("KEPUTUSAN DIREKTUR RSIA MELINDA DHAI", S["sk_title"]),
        Paragraph(f"NOMOR: {nomor_sk}", S["sk_title"]),
        Spacer(1, 2 * mm),
        Paragraph("TENTANG", S["sk_title"]),
        Paragraph(tentang.upper(), S["sk_tentang"]),
        Spacer(1, 2 * mm),
        Paragraph("DIREKTUR RSIA MELINDA DHAI KEDIRI,", S["sk_title"]),
        Spacer(1, 3 * mm),
    ]

    # 3. Konsiderans Menimbang & Mengingat
    konsiderans_rows = []

    menimbang_ps = [Paragraph(f"{chr(97 + idx)}. {txt}", S["body"]) for idx, txt in enumerate(menimbang)]
    konsiderans_rows.append([Paragraph("Menimbang", S["konsiderans_h"]), Paragraph(":", S["konsiderans_h"]), menimbang_ps])

    mengingat_ps = [Paragraph(f"{idx + 1}. {txt}", S["body"]) for idx, txt in enumerate(mengingat)]
    konsiderans_rows.append([Paragraph("Mengingat", S["konsiderans_h"]), Paragraph(":", S["konsiderans_h"]), mengingat_ps])

    table_konsiderans = Table(
        konsiderans_rows,
        colWidths=[24 * mm, 4 * mm, CONTENT_W - 28 * mm],
    )
    table_konsiderans.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 2),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ]
        )
    )

    # 4. Diktum Memutuskan
    diktum_flow = [
        Spacer(1, 2 * mm),
        Paragraph("MEMUTUSKAN:", S["sk_title"]),
        Spacer(1, 1 * mm),
    ]

    diktum_rows = []
    for label, isi in diktum:
        diktum_rows.append(
            [
                Paragraph(label, S["konsiderans_h"]),
                Paragraph(":", S["konsiderans_h"]),
                Paragraph(isi, S["body"]),
            ]
        )

    table_diktum = Table(
        diktum_rows,
        colWidths=[24 * mm, 4 * mm, CONTENT_W - 28 * mm],
    )
    table_diktum.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 2),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ]
        )
    )

    # 5. Tanda Tangan Direktur
    sig_block = Table(
        [
            ["", Paragraph("Ditetapkan di Kediri", S["sig"])],
            ["", Paragraph("pada tanggal 25 Oktober 2026", S["sig"])],
            ["", Paragraph("Direktur RSIA Melinda DHAI,", S["sig"])],
            ["", Spacer(1, 14 * mm)],
            ["", Paragraph(f"<b><u>{SIGNATORY}</u></b>", S["sig_name"])],
        ],
        colWidths=[CONTENT_W - 75 * mm, 75 * mm],
    )
    sig_block.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 1),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
            ]
        )
    )

    doc = BaseDocTemplate(
        str(output_path),
        pagesize=A4,
        leftMargin=LEFT_MARGIN,
        rightMargin=RIGHT_MARGIN,
        topMargin=14 * mm,
        bottomMargin=14 * mm,
    )
    frame = Frame(LEFT_MARGIN, 14 * mm, CONTENT_W, PAGE_H - 28 * mm, id="normal", showBoundary=0)
    doc.addPageTemplates([PageTemplate(id="First", frames=[frame])])

    story = [
        kop_table,
        *header_flow,
        table_konsiderans,
        *diktum_flow,
        table_diktum,
        Spacer(1, 6 * mm),
        KeepTogether([sig_block]),
    ]

    doc.build(story)
    print(f"[SUCCESS] SK Direktur PDF generated successfully at: {output_path}")


def main():
    parser = argparse.ArgumentParser(description="Generate SK Direktur PDF for RSIA Melinda DHAI")
    parser.add_argument("--out", required=True, help="Output PDF file path")
    parser.add_argument("--no-sk", default="001/SK-DIR/I/2099", help="Nomor SK")
    parser.add_argument("--tentang", default="Pemberlakuan Pedoman Tata Kelola Mutu Rumah Sakit dan Standar Akreditasi STARKES", help="Tentang")
    parser.add_argument("--json", help="Path to JSON data file overriding parameters")
    args = parser.parse_args()

    no_sk = args.no_sk
    tentang = args.tentang

    menimbang = [
        "bahwa dalam rangka meningkatkan mutu pelayanan dan menjamin keselamatan pasien, diperlukan tata kelola klinis dan korporat rumah sakit yang terstandarisasi;",
        "bahwa untuk pemenuhan kepatuhan terhadap Standar Akreditasi Rumah Sakit Kemenkes RI (STARKES) dan regulasi perumahsakitan terkini, perlu ditetapkan pedoman resmi rumah sakit;",
        "bahwa berdasarkan pertimbangan sebagaimana dimaksud dalam huruf a dan huruf b, perlu menetapkan Keputusan Direktur RSIA Melinda DHAI.",
    ]

    mengingat = [
        "Undang-Undang Republik Indonesia Nomor 17 Tahun 2023 tentang Kesehatan;",
        "Peraturan Menteri Kesehatan Republik Indonesia Nomor 6 Tahun 2026 tentang Rumah Sakit;",
        "Keputusan Menteri Kesehatan Republik Indonesia Nomor HK.01.07/MENKES/1596/2024 tentang Standar Akreditasi Rumah Sakit;",
        "Akta Pendirian PT. Adianda Melinda Putri Iskandar dan Hospital Bylaws RSIA Melinda DHAI.",
    ]

    diktum = [
        ("KESATU", "Memberlakukan Pedoman Tata Kelola Mutu Rumah Sakit dan Standar Akreditasi STARKES di lingkungan RSIA Melinda DHAI Kediri sebagaimana tercantum dalam lampiran keputusan ini."),
        ("KEDUA", "Pedoman sebagaimana dimaksud dalam Diktum KESATU menjadi acuan wajib bagi seluruh jajaran pimpinan, komite, dan staf pelayanan rumah sakit."),
        ("KETIGA", "Segala biaya yang timbul akibat pelaksanaan keputusan ini dibebankan pada Anggaran Pendapatan dan Belanja Rumah Sakit."),
        ("KEEMPAT", "Keputusan ini berlaku sejak tanggal ditetapkan dengan ketentuan apabila di kemudian hari terdapat kekeliruan akan diadakan perbaikan sebagaimana mestinya."),
    ]

    if args.json and Path(args.json).exists():
        with open(args.json, encoding="utf-8") as f:
            data = json.load(f)
        no_sk = data.get("no_sk", no_sk)
        tentang = data.get("tentang", tentang)
        if "menimbang" in data and isinstance(data["menimbang"], list):
            menimbang = data["menimbang"]
        if "mengingat" in data and isinstance(data["mengingat"], list):
            mengingat = data["mengingat"]
        if "diktum" in data and isinstance(data["diktum"], list):
            diktum = [(d.get("label", "DIKTUM"), d.get("isi", "")) if isinstance(d, dict) else tuple(d) for d in data["diktum"]]

    logo_file = repo("knowledge", "01_HOSPITAL", "poli_penyakit_dalam", "logo-rsia.png")
    build_sk_pdf(
        output_path=Path(args.out),
        nomor_sk=no_sk,
        tentang=tentang,
        menimbang=menimbang,
        mengingat=mengingat,
        diktum=diktum,
        logo_path=logo_file,
    )


if __name__ == "__main__":
    main()
