"""Build opening-package PDFs for Poli Penyakit Dalam. One-off generator."""

from __future__ import annotations

import re
import sys
from pathlib import Path

_TOOLS_DIR = Path(__file__).resolve().parents[1]
if str(_TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(_TOOLS_DIR))

from _paths import REPO_ROOT, first_font  # noqa: E402

from reportlab.lib.colors import HexColor, white
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_RIGHT
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
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)

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

MAROON = HexColor("#6B2340")
INK = HexColor("#1E2430")
MUTED = HexColor("#5E6670")
GOLD = HexColor("#B8956A")
LINE = HexColor("#E4D0D7")
ZEBRA = HexColor("#F8F2F4")
CREAM = HexColor("#FBF7F8")

PAGE_W, PAGE_H = A4
LEFT = 16 * mm
RIGHT = 16 * mm
CONTENT_W = PAGE_W - LEFT - RIGHT
SIGNATORY = "dr. Ferdi Andriska, S.H., M.Kn., CMDC"

ROOT = REPO_ROOT
OUT_DIR = ROOT / "knowledge" / "01_HOSPITAL" / "poli_penyakit_dalam"
LOGO = OUT_DIR / "logo-rsia.png"
POLI = ROOT / "knowledge" / "06_CLINICAL_SAFETY" / "poli_penyakit_dalam"


def esc(text: str) -> str:
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


def styles():
    base = dict(fontName="Calibri", textColor=INK, leading=13)
    return {
        "kicker": ParagraphStyle(
            "kicker",
            fontName="Calibri-Bold",
            fontSize=8,
            leading=10,
            textColor=MAROON,
            alignment=TA_CENTER,
            tracking=0.6,
            spaceAfter=1,
        ),
        "hospital": ParagraphStyle(
            "hospital",
            fontName="Calibri-Bold",
            fontSize=16,
            leading=19,
            textColor=MAROON,
            alignment=TA_CENTER,
            spaceBefore=1,
            spaceAfter=0,
        ),
        "sub": ParagraphStyle(
            "sub",
            fontName="Calibri",
            fontSize=9,
            leading=12,
            textColor=INK,
            alignment=TA_CENTER,
            spaceBefore=1,
            spaceAfter=0,
        ),
        "addr": ParagraphStyle(
            "addr",
            fontName="Calibri",
            fontSize=8.5,
            leading=11,
            textColor=MUTED,
            alignment=TA_CENTER,
            spaceBefore=2,
            spaceAfter=2,
        ),
        "doc_title": ParagraphStyle(
            "doc_title",
            fontName="Calibri-Bold",
            fontSize=13,
            leading=16,
            textColor=INK,
            alignment=TA_CENTER,
            spaceBefore=8,
            spaceAfter=2,
        ),
        "doc_sub": ParagraphStyle(
            "doc_sub",
            fontName="Calibri-Italic",
            fontSize=9,
            leading=12,
            textColor=MUTED,
            alignment=TA_CENTER,
            spaceAfter=8,
        ),
        "h2": ParagraphStyle(
            "h2",
            fontName="Calibri-Bold",
            fontSize=11,
            leading=14,
            textColor=MAROON,
            spaceBefore=11,
            spaceAfter=4,
            keepWithNext=True,
        ),
        "h3": ParagraphStyle(
            "h3",
            fontName="Calibri-Bold",
            fontSize=10,
            leading=13,
            textColor=INK,
            spaceBefore=7,
            spaceAfter=3,
            keepWithNext=True,
        ),
        "draft": ParagraphStyle(
            "draft",
            fontName="Calibri-Bold",
            fontSize=9,
            leading=12,
            textColor=MAROON,
            alignment=TA_CENTER,
            spaceAfter=8,
        ),
        "body": ParagraphStyle(
            "body",
            alignment=TA_JUSTIFY,
            fontSize=9.5,
            spaceAfter=6,
            **base,
        ),
        "li": ParagraphStyle(
            "li",
            fontName="Calibri",
            fontSize=9.5,
            leading=13,
            textColor=INK,
            alignment=TA_JUSTIFY,
            leftIndent=4,
        ),
        "th": ParagraphStyle(
            "th",
            fontName="Calibri-Bold",
            fontSize=8,
            leading=10.5,
            textColor=white,
        ),
        "td": ParagraphStyle(
            "td",
            fontName="Calibri",
            fontSize=8,
            leading=10.5,
            textColor=INK,
        ),
        "meta_l": ParagraphStyle(
            "meta_l",
            fontName="Calibri-Bold",
            fontSize=8,
            leading=10.5,
            textColor=MAROON,
        ),
        "meta_r": ParagraphStyle(
            "meta_r",
            fontName="Calibri",
            fontSize=8,
            leading=10.5,
            textColor=INK,
        ),
        "sig": ParagraphStyle(
            "sig",
            fontName="Calibri",
            fontSize=9.5,
            leading=12,
            textColor=INK,
            alignment=TA_CENTER,
        ),
        "sig_name": ParagraphStyle(
            "sig_name",
            fontName="Calibri-Bold",
            fontSize=9.5,
            leading=12,
            textColor=INK,
            alignment=TA_CENTER,
        ),
        "foot_note": ParagraphStyle(
            "foot_note",
            fontName="Calibri-Italic",
            fontSize=8,
            leading=10.5,
            textColor=MUTED,
            spaceBefore=8,
        ),
    }


S = styles()


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


def parse_blocks(path: Path):
    text = path.read_text(encoding="utf-8")
    body = text.split("---", 2)[2]
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


def line_cells(line: str):
    stripped = line.strip()
    if stripped.startswith("|"):
        stripped = stripped[1:]
    if stripped.endswith("|"):
        stripped = stripped[:-1]
    return [part.strip() for part in stripped.split("|")]


def col_widths(rows):
    cols = len(rows[0])
    weights = []
    for c in range(cols):
        longest = max(len(row[c]) if c < len(row) else 0 for row in rows)
        weights.append(max(longest, 12))
    total = sum(weights)
    widths = [CONTENT_W * w / total for w in weights]
    floors = []
    for c in range(cols):
        words = [w for row in rows if c < len(row) for w in row[c].split()]
        font = "Calibri-Bold" if words and words[0] in rows[0][c].split() else "Calibri"
        longest = max((pdfmetrics.stringWidth(w, font, 8) for w in words), default=0)
        floors.append(longest + 9)
    short = [c for c in range(cols) if widths[c] < floors[c]]
    if short:
        fixed = sum(floors[c] for c in short)
        rest = sum(weights[c] for c in range(cols) if c not in short)
        widths = [
            floors[c] if c in short else (CONTENT_W - fixed) * weights[c] / rest
            for c in range(cols)
        ]
    return widths


def make_table(rows):
    widths = col_widths(rows)
    data = []
    for r_index, row in enumerate(rows):
        style = S["th"] if r_index == 0 else S["td"]
        padded = row + [""] * (len(rows[0]) - len(row))
        data.append([Paragraph(esc(cell), style) for cell in padded])
    heights = None
    if any("Tanda tangan" in cell for cell in rows[0]):
        heights = [None] + [16 * mm] * (len(data) - 1)
    table = Table(data, colWidths=widths, rowHeights=heights, repeatRows=1)
    commands = [
        ("BACKGROUND", (0, 0), (-1, 0), MAROON),
        ("TEXTCOLOR", (0, 0), (-1, 0), white),
        ("FONTNAME", (0, 0), (-1, 0), "Calibri-Bold"),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("GRID", (0, 0), (-1, -1), 0.3, LINE),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 3.5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3.5),
        ("BACKGROUND", (0, 1), (-1, -1), white),
    ]
    for r in range(1, len(data)):
        if r % 2 == 0:
            commands.append(("BACKGROUND", (0, r), (-1, r), ZEBRA))
    table.setStyle(TableStyle(commands))
    table.spaceAfter = 8
    return table


def meta_table(pairs):
    data = [
        [
            Paragraph(esc(left), S["meta_l"]),
            Paragraph(esc(right), S["meta_r"]),
        ]
        for left, right in pairs
    ]
    table = Table(data, colWidths=[38 * mm, CONTENT_W - 38 * mm])
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (0, -1), CREAM),
                ("BACKGROUND", (1, 0), (1, -1), white),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("GRID", (0, 0), (-1, -1), 0.3, LINE),
                ("LEFTPADDING", (0, 0), (-1, -1), 5),
                ("RIGHTPADDING", (0, 0), (-1, -1), 5),
                ("TOPPADDING", (0, 0), (-1, -1), 3),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ]
        )
    )
    table.spaceAfter = 8
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
        bulletFontName="Calibri",
        bulletFontSize=9.5,
        spaceBefore=0,
        spaceAfter=6,
    )
    return lst


def signature_block():
    inner = Table(
        [
            [Paragraph("Ditetapkan di Kediri", S["sig"])],
            [Paragraph("pada tanggal 2 Oktober 2026", S["sig"])],
            [Paragraph("Direktur RSIA Melinda DHAI", S["sig"])],
            [""],
            [Paragraph(esc(SIGNATORY), S["sig_name"])],
        ],
        colWidths=[78 * mm],
        rowHeights=[14, 14, 16, 22 * mm, 36],
    )
    inner.setStyle(
        TableStyle(
            [
                ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 2),
                ("RIGHTPADDING", (0, 0), (-1, -1), 2),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
                ("LINEABOVE", (0, 0), (-1, 0), 0.6, GOLD),
                ("LINEABOVE", (0, 4), (-1, 4), 0.4, INK),
                ("TOPPADDING", (0, 4), (-1, 4), 3),
            ]
        )
    )
    outer = Table(
        [["", inner]],
        colWidths=[CONTENT_W - 78 * mm, 78 * mm],
    )
    outer.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
            ]
        )
    )
    return KeepTogether([Spacer(1, 8 * mm), outer])


def story_for(spec):
    blocks = parse_blocks(spec["source"])
    title = next(text for kind, text in blocks if kind == "h1")
    kop_text = [
        Paragraph("RUMAH SAKIT IBU DAN ANAK", S["kicker"]),
        Paragraph("RSIA MELINDA DHAI", S["hospital"]),
        Paragraph("Kota Kediri", S["sub"]),
        Paragraph(
            "Jl. Balowerti II No. 59, Balowerti, Kota Kediri, Jawa Timur 64129",
            S["addr"],
        ),
        Paragraph(
            "Telp. (0354) 691016&nbsp;&nbsp;|&nbsp;&nbsp;info.melinda@melinda.co.id",
            S["addr"],
        ),
    ]
    logo_w = 20 * mm
    kop = Table(
        [[Image(str(LOGO), width=logo_w, height=logo_w), kop_text, ""]],
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
    flow = [
        kop,
        Spacer(1, 2),
        hline(),
        goldline(),
        Paragraph(esc(title), S["doc_title"]),
        Paragraph(esc(spec["jenis"]), S["doc_sub"]),
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


def draw_later(canvas, doc, spec, total_pages):
    canvas.saveState()
    canvas.setFillColor(MAROON)
    canvas.rect(0, PAGE_H - 14 * mm, PAGE_W, 14 * mm, fill=1, stroke=0)
    canvas.setFillColor(GOLD)
    canvas.rect(0, PAGE_H - 15.2 * mm, PAGE_W, 1.2 * mm, fill=1, stroke=0)
    canvas.setFillColor(white)
    canvas.setFont("Calibri-Bold", 8.5)
    canvas.drawString(LEFT, PAGE_H - 6.2 * mm, "RSIA MELINDA DHAI")
    canvas.setFont("Calibri", 8)
    canvas.drawString(LEFT, PAGE_H - 10.4 * mm, "Rumah Sakit Ibu dan Anak  ·  Kota Kediri")
    canvas.setFont("Calibri", 8)
    canvas.drawRightString(PAGE_W - RIGHT, PAGE_H - 6.2 * mm, spec["header"])
    canvas.drawRightString(PAGE_W - RIGHT, PAGE_H - 10.4 * mm, spec["nomor"])
    draw_footer(canvas, doc, total_pages)
    canvas.restoreState()


def draw_first(canvas, doc, total_pages):
    canvas.saveState()
    draw_footer(canvas, doc, total_pages)
    canvas.restoreState()


def draw_footer(canvas, doc, total_pages):
    canvas.setStrokeColor(MAROON)
    canvas.setLineWidth(0.6)
    canvas.line(LEFT, 12 * mm, PAGE_W - RIGHT, 12 * mm)
    canvas.setFillColor(MUTED)
    canvas.setFont("Calibri", 8)
    canvas.drawString(LEFT, 7.2 * mm, "DRAF UNTUK KOREKSI  ·  Dokumen internal RSIA Melinda DHAI")
    canvas.drawRightString(
        PAGE_W - RIGHT,
        7.2 * mm,
        f"Halaman {doc.page} dari {total_pages}",
    )


def build_one(spec, total_pages):
    out = spec["out"]
    doc = BaseDocTemplate(
        str(out),
        pagesize=A4,
        title=spec["title"],
        author=SIGNATORY,
        subject="RSIA Melinda DHAI — pembukaan Poli Penyakit Dalam",
        creator="RSIA Melinda DHAI",
    )
    frame_first = Frame(
        LEFT,
        16 * mm,
        CONTENT_W,
        PAGE_H - 22 * mm,
        id="first",
        showBoundary=0,
    )
    frame_later = Frame(
        LEFT,
        16 * mm,
        CONTENT_W,
        PAGE_H - 22 * mm - 12 * mm,
        id="later",
        showBoundary=0,
    )
    doc.addPageTemplates(
        [
            PageTemplate(
                id="First",
                frames=[frame_first],
                onPage=lambda c, d: draw_first(c, d, total_pages),
                pagesize=A4,
            ),
            PageTemplate(
                id="Later",
                frames=[frame_later],
                onPage=lambda c, d: draw_later(c, d, spec, total_pages),
                pagesize=A4,
            ),
        ]
    )
    flow = story_for(spec)
    # Switch after the first page.
    from reportlab.platypus import NextPageTemplate, PageBreak

    # BaseDocTemplate uses the first template until NextPageTemplate.
    # Insert the switch at the start so page 2+ uses Later, while page 1 stays First
    # only if we set next template before the break. The reliable pattern is:
    # story starts on First; after enough content a NextPageTemplate('Later') is
    # automatic if we handle onPage by page number instead.
    doc.build(flow)


def build_with_page_numbers(spec):
    """Two passes so the footer can say 'dari N'."""
    counter = {"n": 0}

    def count_pages(canvas, doc):
        counter["n"] = max(counter["n"], doc.page)

    out = spec["out"]
    out.parent.mkdir(parents=True, exist_ok=True)
    doc = BaseDocTemplate(
        str(out),
        pagesize=A4,
        title=spec["title"],
        author=SIGNATORY,
        subject="RSIA Melinda DHAI — pembukaan Poli Penyakit Dalam",
        creator="RSIA Melinda DHAI",
    )
    frame = Frame(LEFT, 16 * mm, CONTENT_W, PAGE_H - 22 * mm, id="f", showBoundary=0)
    frame_later = Frame(
        LEFT, 16 * mm, CONTENT_W, PAGE_H - 34 * mm, id="fl", showBoundary=0
    )
    doc.addPageTemplates(
        [
            PageTemplate(id="First", frames=[frame], onPage=count_pages),
            PageTemplate(id="Later", frames=[frame_later], onPage=count_pages),
        ]
    )
    flow = story_for(spec)
    doc.build(flow, canvasmaker=None)
    # The first pass used First for every page because we never switched templates.
    # Rebuild properly below.
    return counter["n"]


def build_final(spec, total_pages):
    from reportlab.platypus import NextPageTemplate

    doc = BaseDocTemplate(
        str(spec["out"]),
        pagesize=A4,
        title=spec["title"],
        author=SIGNATORY,
        subject="RSIA Melinda DHAI — pembukaan Poli Penyakit Dalam",
        creator="RSIA Melinda DHAI",
    )
    frame_first = Frame(LEFT, 16 * mm, CONTENT_W, PAGE_H - 22 * mm, id="first")
    frame_later = Frame(LEFT, 16 * mm, CONTENT_W, PAGE_H - 34 * mm, id="later")
    doc.addPageTemplates(
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
    flow = [NextPageTemplate("Later")] + story_for(spec)
    doc.build(flow)


DOCS = [
    {
        "source": ROOT
        / "06_CLINICAL_SAFETY"
        / "poli_penyakit_dalam"
        / "kb-klinis-ppk-clinical-pathway-poli-penyakit-dalam.md",
        "out": OUT_DIR / "PPK-Clinical-Pathway-Poli-Penyakit-Dalam.pdf",
        "nomor": "SOP-KLI-PPK-CLINICAL-PATHWAY-POLI-PENYAKIT-DALAM",
        "jenis": "Panduan Praktik Klinis dan Clinical Pathway",
        "unit": "Poli Penyakit Dalam",
        "header": "PPK Poli Penyakit Dalam",
        "title": "PPK dan Clinical Pathway Poli Penyakit Dalam",
    },
    {
        "source": ROOT
        / "06_CLINICAL_SAFETY"
        / "poli_penyakit_dalam"
        / "kb-klinis-sop-rujukan-gawat-darurat-poli-ke-ugd.md",
        "out": OUT_DIR / "SOP-Rujukan-Gawat-Darurat-Poli-ke-UGD.pdf",
        "nomor": "SOP-KLI-SOP-RUJUKAN-GAWAT-DARURAT-POLI-KE-UGD",
        "jenis": "Standar Prosedur Operasional",
        "unit": "Poli Penyakit Dalam / UGD",
        "header": "SOP Rujukan Poli ke UGD",
        "title": "SOP Rujukan Gawat Darurat dari Poli ke UGD",
    },
    {
        "source": ROOT
        / "01_HOSPITAL"
        / "hospital_sop"
        / "kb-operasional-sop-limbah-infeksius-benda-tajam-poli.md",
        "out": OUT_DIR / "SOP-Limbah-Infeksius-dan-Benda-Tajam-Poli.pdf",
        "nomor": "SOP-OPS-SOP-LIMBAH-INFEKSIUS-BENDA-TAJAM-POLI",
        "jenis": "Standar Prosedur Operasional",
        "unit": "Kesehatan Lingkungan / Poli",
        "header": "SOP Limbah Poli",
        "title": "SOP Limbah Medis Infeksius dan Benda Tajam di Poli",
    },
    {
        "source": POLI / "kb-klinis-spo-pelayanan-dokter-spesialis-penyakit-dalam.md",
        "out": OUT_DIR / "SPO-Pelayanan-Dokter-Spesialis-Penyakit-Dalam.pdf",
        "nomor": "SOP-KLI-SPO-PELAYANAN-DOKTER-SPESIALIS-PENYAKIT-DALAM",
        "jenis": "Standar Prosedur Operasional",
        "header": "SPO Pelayanan Sp.PD",
        "title": "SPO Pelayanan Dokter Spesialis Penyakit Dalam",
    },
    {
        "source": POLI / "kb-klinis-clinical-pathway-komorbid-kronis-poli-penyakit-dalam.md",
        "out": OUT_DIR / "Clinical-Pathway-Komorbid-Kronis-Poli-Penyakit-Dalam.pdf",
        "nomor": "SOP-KLI-CLINICAL-PATHWAY-KOMORBID-KRONIS-POLI-PENYAKIT-DALAM",
        "jenis": "Clinical Pathway Rawat Jalan",
        "header": "CP Komorbid Kronis",
        "title": "Clinical Pathway Komorbid Kronis Rawat Jalan Poli Penyakit Dalam",
    },
    {
        "source": POLI / "kb-operasional-sop-rme-poli-penyakit-dalam.md",
        "out": OUT_DIR / "SOP-RME-Poli-Penyakit-Dalam.pdf",
        "nomor": "SOP-OPS-SOP-RME-POLI-PENYAKIT-DALAM",
        "jenis": "Standar Prosedur Operasional",
        "header": "SOP RME Poli",
        "title": "SOP Pengisian Rekam Medis Elektronik Poli Penyakit Dalam",
    },
    {
        "source": POLI / "kb-klinis-sop-ekg-12-lead-dan-gds-poli-penyakit-dalam.md",
        "out": OUT_DIR / "SOP-EKG-12-Lead-dan-GDS-Poli-Penyakit-Dalam.pdf",
        "nomor": "SOP-KLI-SOP-EKG-12-LEAD-DAN-GDS-POLI-PENYAKIT-DALAM",
        "jenis": "Standar Prosedur Operasional",
        "header": "SOP EKG dan GDS",
        "title": "SOP Perekaman EKG 12 Sadapan dan GDS Kapiler",
    },
    {
        "source": POLI / "kb-klinis-sop-prb-dewasa-poli-penyakit-dalam.md",
        "out": OUT_DIR / "SOP-PRB-Dewasa-Poli-Penyakit-Dalam.pdf",
        "nomor": "SOP-KLI-SOP-PRB-DEWASA-POLI-PENYAKIT-DALAM",
        "jenis": "Standar Prosedur Operasional",
        "header": "SOP PRB Dewasa",
        "title": "SOP Program Rujuk Balik Pasien Dewasa Poli Penyakit Dalam",
    },
    {
        "source": ROOT
        / "04_BPJS"
        / "dispute_prevention"
        / "kb-finansial-panduan-koding-dan-administrasi-bpjs-poli-penyakit-dalam.md",
        "out": OUT_DIR / "Panduan-Koding-dan-Administrasi-BPJS-Poli-Penyakit-Dalam.pdf",
        "nomor": "SOP-FIN-PANDUAN-KODING-DAN-ADMINISTRASI-BPJS-POLI-PENYAKIT-DALAM",
        "jenis": "Panduan",
        "header": "Koding dan BPJS Poli PD",
        "title": "Panduan Koding ICD-10 dan Administrasi BPJS Poli Penyakit Dalam",
    },
    {
        "source": POLI / "kb-operasional-sop-pelayanan-poli-eksekutif-penyakit-dalam.md",
        "out": OUT_DIR / "SOP-Pelayanan-Poli-Eksekutif-Penyakit-Dalam.pdf",
        "nomor": "SOP-OPS-SOP-PELAYANAN-POLI-EKSEKUTIF-PENYAKIT-DALAM",
        "jenis": "Standar Prosedur Operasional",
        "header": "SOP Poli Eksekutif",
        "title": "SOP Pelayanan Poli Eksekutif Penyakit Dalam",
    },
    {
        "source": POLI / "kb-operasional-inventaris-dan-checklist-maintenance-poli-penyakit-dalam.md",
        "out": OUT_DIR / "Inventaris-dan-Checklist-Maintenance-Poli-Penyakit-Dalam.pdf",
        "nomor": "SOP-OPS-INVENTARIS-DAN-CHECKLIST-MAINTENANCE-POLI-PENYAKIT-DALAM",
        "jenis": "Daftar Inventaris dan Checklist",
        "header": "Inventaris dan Maintenance",
        "title": "Inventaris Alkes, BMHP, dan Checklist Pemeliharaan Poli Penyakit Dalam",
    },
    {
        "source": POLI / "kb-manajemen-rkk-dan-kredensial-poli-penyakit-dalam.md",
        "out": OUT_DIR / "RKK-dan-Kredensial-Poli-Penyakit-Dalam.pdf",
        "nomor": "SOP-MGT-RKK-DAN-KREDENSIAL-POLI-PENYAKIT-DALAM",
        "jenis": "Rincian Kewenangan Klinis dan Daftar Periksa Kredensial",
        "header": "RKK dan Kredensial",
        "title": "Rincian Kewenangan Klinis Dokter Sp.PD dan Daftar Periksa Kredensial",
    },
    {
        "source": ROOT
        / "04_BPJS"
        / "referral_and_emergency"
        / "kb-operasional-format-surat-kontrol-rawat-jalan-poli-penyakit-dalam.md",
        "out": OUT_DIR / "SOP-Format-Surat-Kontrol-Rawat-Jalan-Poli-Penyakit-Dalam.pdf",
        "nomor": "SOP-OPS-FORMAT-SURAT-KONTROL-RAWAT-JALAN-POLI-PENYAKIT-DALAM",
        "jenis": "Standar Prosedur Operasional dan Format Formulir",
        "header": "Surat Kontrol BPJS",
        "title": "SOP dan Format Surat Kontrol Rawat Jalan BPJS Poli Penyakit Dalam",
    },
    {
        "source": ROOT
        / "04_BPJS"
        / "dispute_prevention"
        / "kb-manajemen-permohonan-penambahan-poli-penyakit-dalam-bpjs.md",
        "out": OUT_DIR / "Permohonan-Penambahan-Poli-Penyakit-Dalam-BPJS.pdf",
        "nomor": "SOP-MGT-PERMOHONAN-PENAMBAHAN-POLI-PENYAKIT-DALAM-BPJS",
        "jenis": "Prosedur Administrasi dan Draf Surat",
        "header": "Penambahan Poli BPJS",
        "title": "Permohonan Penambahan Pelayanan Poli Penyakit Dalam ke BPJS Kesehatan",
    },
    {
        "source": POLI / "kb-klinis-format-persetujuan-tindakan-poli-penyakit-dalam.md",
        "out": OUT_DIR / "SOP-Format-Persetujuan-Tindakan-Poli-Penyakit-Dalam.pdf",
        "nomor": "SOP-KLI-FORMAT-PERSETUJUAN-TINDAKAN-POLI-PENYAKIT-DALAM",
        "jenis": "Standar Prosedur Operasional dan Format Formulir",
        "header": "Persetujuan Tindakan",
        "title": "SOP dan Format Persetujuan atau Penolakan Tindakan Poli Penyakit Dalam",
    },
    {
        "source": ROOT
        / "01_HOSPITAL"
        / "reference"
        / "kb-finansial-kerangka-sk-tarif-poli-eksekutif-penyakit-dalam.md",
        "out": OUT_DIR / "Kerangka-SK-Tarif-Poli-Eksekutif-Penyakit-Dalam.pdf",
        "nomor": "SOP-FIN-KERANGKA-SK-TARIF-POLI-EKSEKUTIF-PENYAKIT-DALAM",
        "jenis": "Kerangka Surat Keputusan Direktur",
        "header": "SK Tarif Eksekutif",
        "title": "Kerangka SK Direktur tentang Tarif Pelayanan Poli Eksekutif Penyakit Dalam",
    },
    {
        "source": ROOT
        / "07_LEGAL_REGULATORY"
        / "pharmacy_policies"
        / "kb-klinis-kerangka-formularium-non-fornas-poli-penyakit-dalam.md",
        "out": OUT_DIR / "Kerangka-Formularium-Non-Fornas-Poli-Penyakit-Dalam.pdf",
        "nomor": "SOP-KLI-KERANGKA-FORMULARIUM-NON-FORNAS-POLI-PENYAKIT-DALAM",
        "jenis": "Kerangka Formularium",
        "header": "Formularium Non-Fornas",
        "title": "Kerangka Penyusunan Formularium Non-Fornas dan Eksekutif Poli Penyakit Dalam",
    },
    {
        "source": POLI / "kb-operasional-sop-pendaftaran-dan-alur-pasien-poli-penyakit-dalam.md",
        "out": OUT_DIR / "SOP-Pendaftaran-dan-Alur-Pasien-Poli-Penyakit-Dalam.pdf",
        "nomor": "SOP-OPS-SOP-PENDAFTARAN-DAN-ALUR-PASIEN-POLI-PENYAKIT-DALAM",
        "jenis": "Standar Prosedur Operasional",
        "header": "Pendaftaran dan Alur Pasien",
        "title": "SOP Pendaftaran dan Alur Pasien Poli Penyakit Dalam",
    },
    {
        "source": POLI / "kb-operasional-formulir-konsul-dan-serah-terima-limbah-poli-penyakit-dalam.md",
        "out": OUT_DIR / "Formulir-Konsul-dan-Serah-Terima-Limbah-Poli-Penyakit-Dalam.pdf",
        "nomor": "SOP-OPS-FORMULIR-KONSUL-DAN-SERAH-TERIMA-LIMBAH-POLI-PENYAKIT-DALAM",
        "jenis": "Format Formulir",
        "header": "Konsul dan Serah Terima Limbah",
        "title": "Lembar Konsul Antarbagian dan Lembar Serah Terima Limbah Harian",
    },
    {
        "source": POLI / "kb-klinis-sop-ppi-poli-penyakit-dalam.md",
        "out": OUT_DIR / "SOP-PPI-Poli-Penyakit-Dalam.pdf",
        "nomor": "SOP-KLI-SOP-PPI-POLI-PENYAKIT-DALAM",
        "jenis": "Standar Prosedur Operasional",
        "header": "PPI Poli",
        "title": "SOP PPI Poli Penyakit Dalam: Kebersihan Tangan, Etika Batuk, dan Skrining TB",
    },
]


def main():
    for spec in DOCS:
        # Pass 1 counts pages with the same frames as the final layout.
        spec_count = dict(spec)
        spec_count["out"] = spec["out"].with_suffix(".count.pdf")
        n = measure(spec)
        build_final(spec, n)
        print(f"{spec['out'].name}: {n} halaman")


def measure(spec):
    """Build once with final frames to learn the page count."""
    from reportlab.platypus import NextPageTemplate

    counter = {"n": 0}

    def mark(canvas, doc):
        counter["n"] = max(counter["n"], doc.page)

    tmp = spec["out"].with_suffix(".count.pdf")
    doc = BaseDocTemplate(str(tmp), pagesize=A4)
    frame_first = Frame(LEFT, 16 * mm, CONTENT_W, PAGE_H - 22 * mm, id="first")
    frame_later = Frame(LEFT, 16 * mm, CONTENT_W, PAGE_H - 34 * mm, id="later")
    doc.addPageTemplates(
        [
            PageTemplate(id="First", frames=[frame_first], onPage=mark),
            PageTemplate(id="Later", frames=[frame_later], onPage=mark),
        ]
    )
    doc.build([NextPageTemplate("Later")] + story_for(spec))
    tmp.unlink(missing_ok=True)
    return counter["n"]


if __name__ == "__main__":
    main()
