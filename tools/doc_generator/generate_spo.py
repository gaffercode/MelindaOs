#!/usr/bin/env python3
"""
RSIA Melinda DHAI Kediri - Universal Document Generator (Standardized Hospital Template)
Mengompilasi dokumen standar rumah sakit (SPO, Pedoman, Panduan, Kerangka Kebijakan)
mengikuti format baku RSIA Melinda DHAI (Kop Resmi, 9 Bab Baku, Tabel Identitas,
dan Matriks Pengesahan 3 Pejabat termasuk Direktur dr. Ferdi Andriska).
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

_TOOLS_DIR = Path(__file__).resolve().parents[1]
if str(_TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(_TOOLS_DIR))

from _paths import first_font, repo  # noqa: E402

from reportlab.lib.colors import HexColor, white
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT, TA_RIGHT
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
    ListFlowable,
    ListItem,
    NextPageTemplate,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)

# Registrasi Font Sistem Windows (Calibri Fallback Helvetica)
try:
    pdfmetrics.registerFont(TTFont("Calibri", str(first_font("Calibri-Regular.ttf", "calibri.ttf"))))
    pdfmetrics.registerFont(TTFont("Calibri-Bold", str(first_font("Calibri-Bold.ttf", "calibrib.ttf"))))
    pdfmetrics.registerFont(TTFont("Calibri-Italic", str(first_font("Calibri-Italic.ttf", "calibrii.ttf"))))
    pdfmetrics.registerFont(TTFont("Calibri-BoldItalic", str(first_font("calibriz.ttf"))))
    pdfmetrics.registerFontFamily(
        "Calibri",
        normal="Calibri",
        bold="Calibri-Bold",
        italic="Calibri-Italic",
        boldItalic="Calibri-BoldItalic",
    )
    FONT_NORMAL = "Calibri"
    FONT_BOLD = "Calibri-Bold"
    FONT_ITALIC = "Calibri-Italic"
except Exception:
    FONT_NORMAL = "Helvetica"
    FONT_BOLD = "Helvetica-Bold"
    FONT_ITALIC = "Helvetica-Oblique"

# Palet Warna Resmi RSIA Melinda DHAI
MAROON = HexColor("#6B2340")
INK = HexColor("#1E2430")
MUTED = HexColor("#5E6670")
GOLD = HexColor("#B8956A")
LINE = HexColor("#E4D0D7")
ZEBRA = HexColor("#F8F2F4")
CREAM = HexColor("#FBF7F8")

PAGE_W, PAGE_H = A4
LEFT_MARGIN = 16 * mm
RIGHT_MARGIN = 16 * mm
CONTENT_W = PAGE_W - LEFT_MARGIN - RIGHT_MARGIN
SIGNATORY = "dr. Ferdi Andriska, S.H., M.Kn., CMDC"


def esc(text: str) -> str:
    return (
        str(text)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


def get_styles() -> dict[str, ParagraphStyle]:
    base = dict(fontName=FONT_NORMAL, textColor=INK, leading=13)
    return {
        "kicker": ParagraphStyle(
            "kicker",
            fontName=FONT_BOLD,
            fontSize=8,
            leading=10,
            textColor=MAROON,
            alignment=TA_CENTER,
            spaceAfter=1,
        ),
        "hospital": ParagraphStyle(
            "hospital",
            fontName=FONT_BOLD,
            fontSize=16,
            leading=19,
            textColor=MAROON,
            alignment=TA_CENTER,
            spaceBefore=1,
            spaceAfter=0,
        ),
        "sub": ParagraphStyle(
            "sub",
            fontName=FONT_NORMAL,
            fontSize=9,
            leading=12,
            textColor=INK,
            alignment=TA_CENTER,
            spaceBefore=1,
            spaceAfter=0,
        ),
        "addr": ParagraphStyle(
            "addr",
            fontName=FONT_NORMAL,
            fontSize=8.5,
            leading=11,
            textColor=MUTED,
            alignment=TA_CENTER,
            spaceBefore=2,
            spaceAfter=2,
        ),
        "doc_title": ParagraphStyle(
            "doc_title",
            fontName=FONT_BOLD,
            fontSize=13,
            leading=16,
            textColor=INK,
            alignment=TA_CENTER,
            spaceBefore=8,
            spaceAfter=2,
        ),
        "doc_sub": ParagraphStyle(
            "doc_sub",
            fontName=FONT_ITALIC,
            fontSize=9,
            leading=12,
            textColor=MUTED,
            alignment=TA_CENTER,
            spaceAfter=6,
        ),
        "draft": ParagraphStyle(
            "draft",
            fontName=FONT_BOLD,
            fontSize=8.5,
            leading=11,
            textColor=MAROON,
            alignment=TA_CENTER,
            spaceAfter=8,
        ),
        "h2": ParagraphStyle(
            "h2",
            fontName=FONT_BOLD,
            fontSize=11,
            leading=14,
            textColor=MAROON,
            spaceBefore=10,
            spaceAfter=4,
            keepWithNext=True,
        ),
        "h3": ParagraphStyle(
            "h3",
            fontName=FONT_BOLD,
            fontSize=10,
            leading=13,
            textColor=INK,
            spaceBefore=7,
            spaceAfter=3,
            keepWithNext=True,
        ),
        "body": ParagraphStyle(
            "body",
            alignment=TA_JUSTIFY,
            fontSize=9.5,
            spaceAfter=5,
            **base,
        ),
        "li": ParagraphStyle(
            "li",
            fontName=FONT_NORMAL,
            fontSize=9.5,
            leading=13,
            textColor=INK,
            alignment=TA_JUSTIFY,
            leftIndent=4,
        ),
        "th": ParagraphStyle(
            "th",
            fontName=FONT_BOLD,
            fontSize=8,
            leading=10.5,
            textColor=white,
        ),
        "td": ParagraphStyle(
            "td",
            fontName=FONT_NORMAL,
            fontSize=8,
            leading=10.5,
            textColor=INK,
        ),
        "meta_l": ParagraphStyle(
            "meta_l",
            fontName=FONT_BOLD,
            fontSize=8,
            leading=10.5,
            textColor=MAROON,
        ),
        "meta_r": ParagraphStyle(
            "meta_r",
            fontName=FONT_NORMAL,
            fontSize=8,
            leading=10.5,
            textColor=INK,
        ),
    }


S = get_styles()


def hline():
    data = [[""]]
    table = Table(data, colWidths=[CONTENT_W], rowHeights=[2.2])
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), MAROON),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ]
        )
    )
    return table


def goldline():
    data = [[""]]
    table = Table(data, colWidths=[CONTENT_W], rowHeights=[1.2])
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), GOLD),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ]
        )
    )
    return table


def col_widths(rows):
    cols = len(rows[0])
    weights = []
    for c in range(cols):
        longest = max(len(str(row[c])) if c < len(row) else 0 for row in rows)
        weights.append(max(longest, 10))
    total = sum(weights)
    widths = [CONTENT_W * w / total for w in weights]
    floors = []
    for c in range(cols):
        words = [w for row in rows if c < len(row) for w in str(row[c]).split()]
        font = FONT_BOLD if words and words[0] in str(rows[0][c]).split() else FONT_NORMAL
        longest = max((pdfmetrics.stringWidth(w, font, 8) for w in words), default=0)
        floors.append(longest + 8)
    short = [c for c in range(cols) if widths[c] < floors[c]]
    if short:
        fixed = sum(floors[c] for c in short)
        rest = sum(weights[c] for c in range(cols) if c not in short)
        widths = [
            floors[c] if c in short else (CONTENT_W - fixed) * weights[c] / (rest or 1)
            for c in range(cols)
        ]
    return widths


def make_table(rows):
    if not rows or not rows[0]:
        return Spacer(1, 2)
    widths = col_widths(rows)
    data = []
    for r_index, row in enumerate(rows):
        style = S["th"] if r_index == 0 else S["td"]
        padded = row + [""] * (len(rows[0]) - len(row))
        data.append([Paragraph(esc(cell), style) for cell in padded])
    heights = None
    if any("Tanda tangan" in str(cell) for cell in rows[0]):
        heights = [None] + [16 * mm] * (len(data) - 1)
    table = Table(data, colWidths=widths, rowHeights=heights, repeatRows=1)
    commands = [
        ("BACKGROUND", (0, 0), (-1, 0), MAROON),
        ("TEXTCOLOR", (0, 0), (-1, 0), white),
        ("FONTNAME", (0, 0), (-1, 0), FONT_BOLD),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("GRID", (0, 0), (-1, -1), 0.3, LINE),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("BACKGROUND", (0, 1), (-1, -1), white),
    ]
    for r in range(1, len(data)):
        if r % 2 == 0:
            commands.append(("BACKGROUND", (0, r), (-1, r), ZEBRA))
    table.setStyle(TableStyle(commands))
    table.spaceAfter = 6
    return table


def bullet_list(items, ordered=False):
    flow = []
    for index, item in enumerate(items, 1):
        flow.append(
            ListItem(
                Paragraph(esc(item), S["li"]),
                leftIndent=12,
                bulletColor=MAROON if not ordered else INK,
            )
        )
    lst = ListFlowable(
        flow,
        bulletType="1" if ordered else "bullet",
        start="1" if ordered else None,
        leftIndent=14,
        bulletFontName=FONT_NORMAL,
        bulletFontSize=9.5,
        spaceBefore=0,
        spaceAfter=5,
    )
    return lst


def draw_first(canvas, doc, total_pages):
    canvas.saveState()
    draw_footer(canvas, doc, total_pages)
    canvas.restoreState()


def draw_later(canvas, doc, spec, total_pages):
    canvas.saveState()
    canvas.setFillColor(MAROON)
    canvas.rect(0, PAGE_H - 14 * mm, PAGE_W, 14 * mm, fill=1, stroke=0)
    canvas.setFillColor(GOLD)
    canvas.rect(0, PAGE_H - 15.2 * mm, PAGE_W, 1.2 * mm, fill=1, stroke=0)
    canvas.setFillColor(white)
    canvas.setFont(FONT_BOLD, 8.5)
    canvas.drawString(LEFT_MARGIN, PAGE_H - 6.2 * mm, "RSIA MELINDA DHAI")
    canvas.setFont(FONT_NORMAL, 8)
    canvas.drawString(LEFT_MARGIN, PAGE_H - 10.4 * mm, "Rumah Sakit Ibu dan Anak · Kota Kediri")
    canvas.setFont(FONT_NORMAL, 8)
    canvas.drawRightString(PAGE_W - RIGHT_MARGIN, PAGE_H - 6.2 * mm, str(spec.get("header", "Dokumen Standar RS")))
    canvas.drawRightString(PAGE_W - RIGHT_MARGIN, PAGE_H - 10.4 * mm, str(spec.get("nomor", "RSIA Melinda DHAI")))
    draw_footer(canvas, doc, total_pages)
    canvas.restoreState()


def draw_footer(canvas, doc, total_pages):
    canvas.setStrokeColor(MAROON)
    canvas.setLineWidth(0.6)
    canvas.line(LEFT_MARGIN, 12 * mm, PAGE_W - RIGHT_MARGIN, 12 * mm)
    canvas.setFillColor(MUTED)
    canvas.setFont(FONT_NORMAL, 8)
    canvas.drawString(LEFT_MARGIN, 7.2 * mm, "DRAF UNTUK KOREKSI · Dokumen internal RSIA Melinda DHAI")
    canvas.drawRightString(
        PAGE_W - RIGHT_MARGIN,
        7.2 * mm,
        f"Halaman {doc.page} dari {total_pages}",
    )


def line_cells(line: str):
    stripped = line.strip()
    if stripped.startswith("|"):
        stripped = stripped[1:]
    if stripped.endswith("|"):
        stripped = stripped[:-1]
    return [part.strip() for part in stripped.split("|")]


def parse_markdown_blocks(text: str) -> list[tuple[str, any]]:
    if "---" in text:
        parts = text.split("---", 2)
        body = parts[2] if len(parts) >= 3 else text
    else:
        body = text

    lines = body.splitlines()
    blocks = []
    i = 0
    while i < len(lines):
        line = lines[i]
        if line.startswith("# "):
            blocks.append(("h1", line[2:].strip()))
            i += 1
        elif line.startswith("### "):
            blocks.append(("h3", line[4:].strip()))
            i += 1
        elif line.startswith("## "):
            blocks.append(("h2", line[3:].strip()))
            i += 1
        elif line.startswith("|"):
            rows = []
            while i < len(lines) and lines[i].startswith("|"):
                cells = [c.strip() for c in line_cells(lines[i])]
                if cells and not all(re.fullmatch(r":?-{3,}:?", c) for c in cells):
                    rows.append(cells)
                i += 1
            blocks.append(("table", rows))
        elif re.match(r"^\d+\.\s", line):
            items = []
            while i < len(lines) and re.match(r"^\d+\.\s", lines[i]):
                items.append(re.sub(r"^\d+\.\s+", "", lines[i]).strip())
                i += 1
            blocks.append(("ol", items))
        elif line.startswith("- "):
            items = []
            while i < len(lines) and lines[i].startswith("- "):
                items.append(lines[i][2:].strip())
                i += 1
            blocks.append(("ul", items))
        elif not line.strip():
            i += 1
        else:
            blocks.append(("p", line.strip()))
            i += 1
    return blocks


def story_for(spec: dict, blocks: list[tuple[str, any]], logo_path: Path | None) -> list:
    kop_text = [
        Paragraph("RUMAH SAKIT IBU DAN ANAK", S["kicker"]),
        Paragraph("RSIA MELINDA DHAI", S["hospital"]),
        Paragraph("Kota Kediri", S["sub"]),
        Paragraph("Jl. Balowerti II No. 59, Balowerti, Kota Kediri, Jawa Timur 64129", S["addr"]),
        Paragraph("Telp. (0354) 691016&nbsp;&nbsp;|&nbsp;&nbsp;info.melinda@melinda.co.id", S["addr"]),
    ]
    logo_w = 20 * mm
    logo_flow = [Image(str(logo_path), width=logo_w, height=logo_w)] if logo_path and logo_path.exists() else [""]

    kop = Table(
        [[logo_flow[0], kop_text, ""]],
        colWidths=[logo_w + 4 * mm, CONTENT_W - 2 * (logo_w + 4 * mm), logo_w + 4 * mm],
    )
    kop.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
            ]
        )
    )

    title = spec.get("title", "Dokumen Standar Rumah Sakit")
    jenis = spec.get("jenis", "Standar Prosedur Operasional")

    flow = [
        kop,
        Spacer(1, 2),
        hline(),
        goldline(),
        Paragraph(esc(title), S["doc_title"]),
        Paragraph(esc(jenis), S["doc_sub"]),
        Paragraph("DRAF UNTUK KOREKSI — belum berlaku sebelum nomor dokumen dan tanda tangan diisi", S["draft"]),
    ]

    for kind, payload in blocks:
        if kind == "h1":
            continue
        if kind == "h2":
            flow.append(Paragraph(esc(payload), S["h2"]))
        elif kind == "h3":
            flow.append(Paragraph(esc(payload), S["h3"]))
        elif kind == "p":
            flow.append(Paragraph(esc(payload), S["body"]))
        elif kind == "ol":
            flow.append(bullet_list(payload, ordered=True))
        elif kind == "ul":
            flow.append(bullet_list(payload, ordered=False))
        elif kind == "table":
            flow.append(make_table(payload))

    return flow


def build_two_pass_pdf(output_path: Path, spec: dict, blocks: list[tuple[str, any]], logo_path: Path | None):
    output_path.parent.mkdir(parents=True, exist_ok=True)

    # First Pass: Count Total Pages
    counter = {"n": 1}

    def count_pages(canvas, doc):
        counter["n"] = max(counter["n"], doc.page)

    doc_pass1 = BaseDocTemplate(
        str(output_path),
        pagesize=A4,
        title=spec.get("title", "Dokumen Standar"),
        author=SIGNATORY,
    )
    frame1 = Frame(LEFT_MARGIN, 16 * mm, CONTENT_W, PAGE_H - 22 * mm, id="f1", showBoundary=0)
    doc_pass1.addPageTemplates([PageTemplate(id="First", frames=[frame1], onPage=count_pages)])
    flow1 = story_for(spec, blocks, logo_path)
    doc_pass1.build(flow1)

    total_pages = counter["n"]

    # Second Pass: Render With Perfect Running Headers and Footers
    doc_pass2 = BaseDocTemplate(
        str(output_path),
        pagesize=A4,
        title=spec.get("title", "Dokumen Standar"),
        author=SIGNATORY,
    )
    frame_first = Frame(LEFT_MARGIN, 16 * mm, CONTENT_W, PAGE_H - 22 * mm, id="first", showBoundary=0)
    frame_later = Frame(LEFT_MARGIN, 16 * mm, CONTENT_W, PAGE_H - 34 * mm, id="later", showBoundary=0)

    doc_pass2.addPageTemplates(
        [
            PageTemplate(
                id="First",
                frames=[frame_first],
                onPage=lambda c, d: draw_first(c, d, total_pages),
            ),
            PageTemplate(
                id="Later",
                frames=[frame_later],
                onPage=lambda c, d: draw_later(c, d, spec, total_pages),
            ),
        ]
    )

    flow2 = [NextPageTemplate("Later")] + story_for(spec, blocks, logo_path)
    doc_pass2.build(flow2)
    print(f"[SUCCESS] PDF generated successfully ({total_pages} halaman): {output_path}")


def main():
    parser = argparse.ArgumentParser(description="Generate Official RSIA Melinda DHAI Standardized Document PDF")
    parser.add_argument("--out", required=True, help="Output PDF file path")
    parser.add_argument("--src", help="Source Markdown file path")
    parser.add_argument("--json", help="Source JSON payload file path")
    parser.add_argument("--title", default="Dokumen Standar Rumah Sakit", help="Judul Dokumen")
    parser.add_argument("--jenis", default="Standar Prosedur Operasional", help="Jenis Dokumen")
    parser.add_argument("--nomor", default="SOP-RSIA-MELINDA-001", help="Nomor Dokumen")
    parser.add_argument("--header", default="RSIA Melinda DHAI", help="Running Header Kanan")
    args = parser.parse_args()

    spec = {
        "title": args.title,
        "jenis": args.jenis,
        "nomor": args.nomor,
        "header": args.header,
    }

    blocks = []
    if args.src and Path(args.src).exists():
        text = Path(args.src).read_text(encoding="utf-8")
        blocks = parse_markdown_blocks(text)
        for kind, val in blocks:
            if kind == "h1":
                spec["title"] = val
                break
    elif args.json and Path(args.json).exists():
        with open(args.json, encoding="utf-8") as f:
            data = json.load(f)
        spec["title"] = data.get("title", args.title)
        spec["jenis"] = data.get("jenis", args.jenis)
        spec["nomor"] = data.get("nomor", data.get("doc_no", args.nomor))
        spec["header"] = data.get("header", args.header)
        if "markdown" in data and isinstance(data["markdown"], str):
            blocks = parse_markdown_blocks(data["markdown"])
        elif "blocks" in data and isinstance(data["blocks"], list):
            blocks = data["blocks"]
        elif "sections" in data and isinstance(data["sections"], dict):
            # Parse structured sections payload into canonical MelindaOS blocks
            identitas_rows = [["Butir", "Isi"]]
            identitas_rows.append(["Rumah sakit", data.get("hospital", "RSIA Melinda DHAI, Jl. Balowerti II No. 59, Kediri, Jawa Timur")])
            identitas_rows.append(["Telepon dan website", data.get("contact", "(0354) 691016; melinda.co.id")])
            identitas_rows.append(["Jenis dokumen", spec["jenis"]])
            identitas_rows.append(["Nomor dokumen", spec["nomor"]])
            identitas_rows.append(["Nomor revisi", str(data.get("rev", "00"))])
            identitas_rows.append(["Tanggal terbit / berlaku", f"{data.get('date', '[ISI]')} / {data.get('date_effective', data.get('date', '[ISI]'))}"])
            identitas_rows.append(["Unit pemilik", data.get("unit", "Pelayanan Medis / Komite Medik")])
            identitas_rows.append(["Status", data.get("status", "DRAF UNTUK KOREKSI")])

            blocks.append(("h2", "Identitas Dokumen"))
            blocks.append(("table", identitas_rows))

            for key, val in data["sections"].items():
                title = str(key).strip()
                blocks.append(("h2", title))
                if isinstance(val, list):
                    if val and isinstance(val[0], list):
                        blocks.append(("table", val))
                    else:
                        for item in val:
                            blocks.append(("p", str(item).strip()))
                elif isinstance(val, str):
                    for line in val.splitlines():
                        if line.strip():
                            blocks.append(("p", line.strip()))

            pengesahan_rows = [
                ["Peran", "Jabatan", "Nama", "Tanda tangan dan tanggal"],
                ["Disusun oleh", data.get("disusun_jabatan", "Penanggung Jawab Prosedur"), data.get("disusun_nama", "[ISI]"), "[ISI]"],
                ["Diperiksa oleh", data.get("diperiksa_jabatan", "Ketua Komite / Kepala Bidang"), data.get("diperiksa_nama", "[ISI]"), "[ISI]"],
                ["Disahkan oleh", "Direktur", SIGNATORY, "[ISI]"],
            ]
            blocks.append(("h2", "Pengesahan Dokumen"))
            blocks.append(("table", pengesahan_rows))
    else:
        default_md = """
# Kerangka Penyusunan Formularium Non-Fornas dan Eksekutif Poli Penyakit Dalam

## Identitas Dokumen

| Butir | Isi |
| --- | --- |
| Rumah sakit | RSIA Melinda DHAI, Jl. Balowerti II No. 59, Kediri, Jawa Timur |
| Telepon dan website | (0354) 691016; melinda.co.id |
| Jenis dokumen | Kerangka formularium dan prosedur penyusunan |
| Nomor dokumen | [ISI dari register resmi RS] |
| Nomor revisi | 00 |
| Tanggal terbit / berlaku | [ISI] / [ISI] |
| Unit pemilik | Farmasi / Komite Farmasi dan Terapi |
| Status | DRAF UNTUK KOREKSI; daftar obat belum diisi |

## 1. Pengertian
Formularium Rumah Sakit adalah daftar obat yang disepakati staf medis, disusun Komite/Tim Farmasi dan Terapi (KFT), dan ditetapkan pimpinan RS (Permenkes 72/2016). Formularium Nasional (Fornas) adalah daftar obat terpilih sebagai acuan penulisan resep dalam program jaminan kesehatan. Obat non-Fornas adalah obat dalam formularium RS yang tidak tercantum dalam Fornas, dipakai untuk pasien umum, asuransi, dan eksekutif.

## 2. Tujuan
Dokter Sp.PD, farmasi, dan kasir memakai satu daftar obat yang sama, dengan status Fornas dan penjamin yang jelas, sehingga obat non-Fornas tidak ditagihkan secara keliru ke pasien JKN.

## 3. Ruang Lingkup
Obat yang diusulkan untuk pelayanan Poli Penyakit Dalam reguler dan eksekutif, rawat jalan dan rawat inap.

## 4. Kebijakan
1. Formularium RS disusun mengacu pada Fornas (Permenkes 72/2016). Fornas yang berlaku adalah KMK HK.01.07/MENKES/1199/2025, diterapkan sejak 1 April 2026; KMK 2197/2023 dan perubahannya sudah dicabut.
2. Kriteria obat masuk formularium (Permenkes 72/2016): mengutamakan obat generik; rasio manfaat-risiko paling menguntungkan; mutu terjamin; praktis disimpan, diangkut, dipakai, dan diserahkan; mendukung kepatuhan pasien; rasio manfaat-biaya tertinggi; dan obat lain yang terbukti paling efektif dan aman dengan harga terjangkau.
3. Pasien JKN diresepkan obat Fornas. Diktum KELIMA KMK 1199/2025 mengatur obat yang dibutuhkan tetapi tidak tercantum dalam Fornas: penggunaannya terbatas dan memerlukan persetujuan kepala atau direktur faskes.
4. Obat non-Fornas untuk pasien umum, asuransi, dan eksekutif disampaikan beserta harganya sebelum diberikan.
5. RS harus punya kebijakan penambahan atau pengurangan obat formularium berdasarkan indikasi, efektivitas, risiko, dan biaya (Permenkes 72/2016).
6. Komite Farmasi belum terbentuk menurut daftar komite RS. Formularium tidak dapat ditetapkan sebelum KFT dibentuk Direktur.

## 5. Tanggung Jawab

| Peran | Pemegang |
| --- | --- |
| Pengusul obat | Dokter Sp.PD |
| Penyusun dan pembahas | Komite/Tim Farmasi dan Terapi [ISI] |
| Pengelola daftar dan harga | Kepala Instalasi Farmasi [ISI] |
| Penetap | Direktur |

## 6. Unit Terkait
Instalasi Farmasi, Komite Medik, Poli Penyakit Dalam, keuangan, kasir, dan unit klaim.

## 7. Prosedur

### A. Penyusunan Formularium (Permenkes 72/2016)

| Langkah | Pelaksana | Tindakan / kriteria selesai |
| --- | --- | --- |
| 1 | Farmasi | Rekap usulan obat dari dokter Sp.PD berdasarkan PPK dan clinical pathway poli. |
| 2 | Farmasi | Kelompokkan usulan menurut kelas terapi dan tandai status Fornas tiap obat. |
| 3 | KFT | Bahas usulan dalam rapat; bila perlu minta masukan pakar. |
| 4 | KFT | Kembalikan rancangan ke dokter pengusul untuk umpan balik. |
| 5 | KFT | Bahas umpan balik dan tetapkan daftar obat. |
| 6 | Direktur | Tetapkan formularium dengan SK. |
| 7 | KFT + Farmasi | Susun kebijakan pelaksanaan, edukasi staf, dan pantau kepatuhan. Evaluasi rutin dan revisi bila perlu. |

### B. Format Tabel Formularium

| Kolom | Isi |
| --- | --- |
| Nama generik | Wajib |
| Nama dagang | Bila ada beberapa merek, sebutkan yang disediakan |
| Sediaan dan kekuatan | Misalnya tablet 500 mg |
| Kelas terapi | Sesuai pengelompokan Fornas |
| Status Fornas | Fornas / non-Fornas |
| Restriksi | Indikasi, peresep, atau batas jumlah |
| Penjamin | JKN / umum / asuransi / eksekutif |
| Harga jual | [ISI dari farmasi] |

## 8. Dokumen Terkait
- PPK dan Clinical Pathway Poli Penyakit Dalam; Clinical Pathway Komorbid Kronis.
- SOP Peresepan Obat Secara Elektronik.
- SOP Pelayanan Poli Eksekutif Penyakit Dalam.
- Regulasi: Permenkes 72/2016 tentang Standar Pelayanan Kefarmasian di Rumah Sakit; KMK HK.01.07/MENKES/1199/2025 tentang Formularium Nasional; Permenkes 6/2026.

## 9. Riwayat Revisi

| Revisi | Tanggal | Bagian / ringkasan perubahan |
| --- | --- | --- |
| 00 | [ISI] | Penerbitan awal (draf untuk koreksi) |

## Pengesahan Dokumen

| Peran | Jabatan | Nama | Tanda tangan dan tanggal |
| --- | --- | --- | --- |
| Disusun oleh | Kepala Instalasi Farmasi [CEK] | [ISI] | [ISI] |
| Diperiksa oleh | Ketua Komite/Tim Farmasi dan Terapi | [ISI] | [ISI] |
| Disahkan oleh | Direktur | dr. Ferdi Andriska, S.H., M.Kn., CMDC | [ISI] |
"""
        blocks = parse_markdown_blocks(default_md)

    logo_path = repo("knowledge", "01_HOSPITAL", "poli_penyakit_dalam", "logo-rsia.png")
    build_two_pass_pdf(Path(args.out), spec, blocks, logo_path)


if __name__ == "__main__":
    main()
