"""Clean, formal, readable Black & White / Grayscale Hospital PDF generator for RSIA Melinda DHAI.
Comfortable font sizes: Body 10pt, Tables 9pt-9.5pt, Headings 11pt-14pt. Zero eye strain.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

_TOOLS_DIR = Path(__file__).resolve().parents[1]
if str(_TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(_TOOLS_DIR))

from _paths import first_font, repo  # noqa: E402

from reportlab.lib.colors import HexColor, white
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_RIGHT, TA_LEFT
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
    NextPageTemplate,
)

# Fonts
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

# Pure Black & White / Grayscale Palette
BLACK = HexColor("#111111")
GRAY_TEXT = HexColor("#444444")
BORDER_BLACK = HexColor("#333333")
TABLE_HEADER_BG = HexColor("#EAEAEA")
ZEBRA_BG = HexColor("#F8F8F8")

PAGE_W, PAGE_H = A4
LEFT = 15 * mm
RIGHT = 15 * mm
CONTENT_W = PAGE_W - LEFT - RIGHT
SIGNATORY = "dr. Ferdi Andriska, S.H., M.Kn., CMDC"

LOGO = repo("knowledge", "01_HOSPITAL", "poli_penyakit_dalam", "logo-rsia.png")


def esc(text: str) -> str:
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


def styles():
    return {
        "kicker": ParagraphStyle(
            "kicker",
            fontName="Calibri-Bold",
            fontSize=9,
            leading=11.5,
            textColor=BLACK,
            alignment=TA_CENTER,
            spaceAfter=1,
        ),
        "hospital": ParagraphStyle(
            "hospital",
            fontName="Calibri-Bold",
            fontSize=16,
            leading=19.5,
            textColor=BLACK,
            alignment=TA_CENTER,
            spaceBefore=1,
            spaceAfter=0,
        ),
        "sub": ParagraphStyle(
            "sub",
            fontName="Calibri",
            fontSize=10,
            leading=13,
            textColor=BLACK,
            alignment=TA_CENTER,
            spaceBefore=1,
            spaceAfter=0,
        ),
        "addr": ParagraphStyle(
            "addr",
            fontName="Calibri",
            fontSize=8.5,
            leading=11.5,
            textColor=GRAY_TEXT,
            alignment=TA_CENTER,
            spaceBefore=1,
            spaceAfter=1,
        ),
        "doc_title": ParagraphStyle(
            "doc_title",
            fontName="Calibri-Bold",
            fontSize=14,
            leading=17.5,
            textColor=BLACK,
            alignment=TA_CENTER,
            spaceBefore=10,
            spaceAfter=3,
        ),
        "doc_sub": ParagraphStyle(
            "doc_sub",
            fontName="Calibri-Italic",
            fontSize=10,
            leading=13.5,
            textColor=GRAY_TEXT,
            alignment=TA_CENTER,
            spaceAfter=6,
        ),
        "draft": ParagraphStyle(
            "draft",
            fontName="Calibri-Bold",
            fontSize=9,
            leading=12,
            textColor=GRAY_TEXT,
            alignment=TA_CENTER,
            spaceAfter=8,
        ),
        "h2": ParagraphStyle(
            "h2",
            fontName="Calibri-Bold",
            fontSize=11.5,
            leading=15,
            textColor=BLACK,
            spaceBefore=11,
            spaceAfter=4,
            keepWithNext=True,
        ),
        "h3": ParagraphStyle(
            "h3",
            fontName="Calibri-Bold",
            fontSize=10.5,
            leading=13.5,
            textColor=BLACK,
            spaceBefore=8,
            spaceAfter=3,
            keepWithNext=True,
        ),
        "body": ParagraphStyle(
            "body",
            fontName="Calibri",
            textColor=BLACK,
            alignment=TA_JUSTIFY,
            fontSize=10,
            leading=14,
            spaceAfter=6,
        ),
        "li": ParagraphStyle(
            "li",
            fontName="Calibri",
            fontSize=10,
            leading=14,
            textColor=BLACK,
            alignment=TA_JUSTIFY,
            leftIndent=4,
        ),
        "th": ParagraphStyle(
            "th",
            fontName="Calibri-Bold",
            fontSize=9,
            leading=11.5,
            textColor=BLACK,
            alignment=TA_CENTER,
        ),
        "td": ParagraphStyle(
            "td",
            fontName="Calibri",
            fontSize=9,
            leading=11.5,
            textColor=BLACK,
        ),
        "meta_l": ParagraphStyle(
            "meta_l",
            fontName="Calibri-Bold",
            fontSize=9.5,
            leading=12.5,
            textColor=BLACK,
        ),
        "meta_r": ParagraphStyle(
            "meta_r",
            fontName="Calibri",
            fontSize=9.5,
            leading=12.5,
            textColor=BLACK,
        ),
    }


S = styles()


def black_divider():
    """Clean black double line for hospital kop."""
    data = [[""], [""]]
    table = Table(data, colWidths=[CONTENT_W], rowHeights=[1.5, 0.6])
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), BLACK),
                ("BACKGROUND", (0, 1), (-1, 1), white),
                ("LINEBELOW", (0, 1), (-1, 1), 0.5, BLACK),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ]
        )
    )
    return table


def line_cells(line: str):
    stripped = line.strip()
    if stripped.startswith("|"):
        stripped = stripped[1:]
    if stripped.endswith("|"):
        stripped = stripped[:-1]
    return [part.strip() for part in stripped.split("|")]


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
        elif line.startswith("- ") or line.startswith("• "):
            items = []
            while i < len(lines) and (lines[i].startswith("- ") or lines[i].startswith("• ")):
                content = lines[i][2:].strip()
                items.append(content)
                i += 1
            blocks.append(("ul", items))
        elif not line.strip():
            i += 1
        else:
            blocks.append(("p", line.strip()))
            i += 1
    return blocks


def bullet_list(items, ordered=False):
    flow = []
    for index, item in enumerate(items, 1):
        flow.append(
            ListItem(
                Paragraph(esc(item), S["li"]),
                leftIndent=12,
                bulletColor=BLACK,
            )
        )
    lst = ListFlowable(
        flow,
        bulletType="1" if ordered else "bullet",
        start="1" if ordered else None,
        leftIndent=14,
        bulletFontName="Calibri-Bold" if ordered else "Calibri",
        bulletFontSize=9.5,
        spaceBefore=0,
        spaceAfter=6,
    )
    return lst


def col_widths(rows):
    cols = len(rows[0])
    weights = []
    for c in range(cols):
        longest = max(len(row[c]) if c < len(row) else 0 for row in rows)
        weights.append(max(longest, 10))
    total = sum(weights)
    widths = [CONTENT_W * w / total for w in weights]
    floors = []
    for c in range(cols):
        words = [w for row in rows if c < len(row) for w in row[c].split()]
        font = "Calibri-Bold" if words and words[0] in rows[0][c].split() else "Calibri"
        longest = max((pdfmetrics.stringWidth(w, font, 9) for w in words), default=0)
        floors.append(longest + 8)
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
    if len(rows[0]) == 2 and rows[0][0].strip().lower() == "butir":
        # Metadata table
        data = [
            [
                Paragraph(esc(r[0]), S["meta_l"]),
                Paragraph(esc(r[1]), S["meta_r"]),
            ]
            for r in rows[1:]
        ]
        table = Table(data, colWidths=[45 * mm, CONTENT_W - 45 * mm])
        table.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (0, -1), TABLE_HEADER_BG),
                    ("BACKGROUND", (1, 0), (1, -1), white),
                    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                    ("GRID", (0, 0), (-1, -1), 0.4, BORDER_BLACK),
                    ("LEFTPADDING", (0, 0), (-1, -1), 6),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                    ("TOPPADDING", (0, 0), (-1, -1), 3.5),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 3.5),
                ]
            )
        )
        table.spaceAfter = 8
        return table

    widths = col_widths(rows)
    data = []
    for r_index, row in enumerate(rows):
        padded = row + [""] * (len(rows[0]) - len(row))
        if r_index == 0:
            data.append([Paragraph(esc(cell), S["th"]) for cell in padded])
        else:
            data.append([Paragraph(esc(cell), S["td"]) for cell in padded])
    
    heights = None
    if any("Tanda tangan" in cell for cell in rows[0]):
        heights = [None] + [18 * mm] * (len(data) - 1)
        
    table = Table(data, colWidths=widths, rowHeights=heights, repeatRows=1)
    commands = [
        ("BACKGROUND", (0, 0), (-1, 0), TABLE_HEADER_BG),
        ("TEXTCOLOR", (0, 0), (-1, 0), BLACK),
        ("FONTNAME", (0, 0), (-1, 0), "Calibri-Bold"),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("GRID", (0, 0), (-1, -1), 0.4, BORDER_BLACK),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("BACKGROUND", (0, 1), (-1, -1), white),
    ]
    for r in range(1, len(data)):
        if r % 2 == 0:
            commands.append(("BACKGROUND", (0, r), (-1, r), ZEBRA_BG))
    table.setStyle(TableStyle(commands))
    table.spaceAfter = 8
    return table


def story_for(spec):
    blocks = parse_blocks(spec["source"])
    title = next(text for kind, text in blocks if kind == "h1")
    
    # Clean black and white Kop Surat
    kop_text = [
        Paragraph("RUMAH SAKIT IBU DAN ANAK", S["kicker"]),
        Paragraph("RSIA MELINDA DHAI", S["hospital"]),
        Paragraph("Kota Kediri", S["sub"]),
        Paragraph(
            "Jl. Balowerti II No. 59, Balowerti, Kota Kediri, Jawa Timur 64129",
            S["addr"],
        ),
        Paragraph(
            "Telp. (0354) 691016   |   info.melinda@melinda.co.id",
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
        Spacer(1, 1 * mm),
        black_divider(),
        Spacer(1, 3 * mm),
        Paragraph(esc(title), S["doc_title"]),
        Paragraph(esc(spec.get("jenis", "Clinical Pathway")), S["doc_sub"]),
        Spacer(1, 3 * mm),
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


def draw_first(canvas, doc, total_pages):
    canvas.saveState()
    draw_footer(canvas, doc, total_pages)
    canvas.restoreState()


def draw_later(canvas, doc, spec, total_pages):
    canvas.saveState()
    canvas.setFont("Calibri-Bold", 8.5)
    canvas.setFillColor(BLACK)
    canvas.drawString(LEFT, PAGE_H - 10 * mm, "RSIA MELINDA DHAI — KOTA KEDIRI")
    canvas.setFont("Calibri", 8.5)
    canvas.drawRightString(PAGE_W - RIGHT, PAGE_H - 10 * mm, spec.get("header", "Clinical Pathway"))
    canvas.setStrokeColor(BLACK)
    canvas.setLineWidth(0.5)
    canvas.line(LEFT, PAGE_H - 11.5 * mm, PAGE_W - RIGHT, PAGE_H - 11.5 * mm)
    
    draw_footer(canvas, doc, total_pages)
    canvas.restoreState()


def draw_footer(canvas, doc, total_pages):
    canvas.setStrokeColor(BORDER_BLACK)
    canvas.setLineWidth(0.4)
    canvas.line(LEFT, 11 * mm, PAGE_W - RIGHT, 11 * mm)
    canvas.setFillColor(GRAY_TEXT)
    canvas.setFont("Calibri", 8)
    canvas.drawString(LEFT, 7.5 * mm, "RSIA Melinda DHAI  ·  Dokumen Pelayanan Medis")
    canvas.drawRightString(
        PAGE_W - RIGHT,
        7.5 * mm,
        f"Halaman {doc.page} dari {total_pages}",
    )


def build_clean_pdf(spec):
    out = spec["out"]
    out.parent.mkdir(parents=True, exist_ok=True)
    
    # Pass 1: measure total pages
    counter = {"n": 0}
    def count_pages(canvas, doc):
        counter["n"] = max(counter["n"], doc.page)

    tmp = out.with_suffix(".count.pdf")
    doc_count = BaseDocTemplate(str(tmp), pagesize=A4)
    frame_first = Frame(LEFT, 14 * mm, CONTENT_W, PAGE_H - 20 * mm, id="first")
    frame_later = Frame(LEFT, 14 * mm, CONTENT_W, PAGE_H - 26 * mm, id="later")
    doc_count.addPageTemplates(
        [
            PageTemplate(id="First", frames=[frame_first], onPage=count_pages),
            PageTemplate(id="Later", frames=[frame_later], onPage=count_pages),
        ]
    )
    doc_count.build([NextPageTemplate("Later")] + story_for(spec))
    tmp.unlink(missing_ok=True)
    total_pages = counter["n"]
    
    # Pass 2: build final
    doc = BaseDocTemplate(
        str(out),
        pagesize=A4,
        title=spec["title"],
        author=SIGNATORY,
        subject="Dokumen Pelayanan RSIA Melinda DHAI",
        creator="RSIA Melinda DHAI",
    )
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
    doc.build([NextPageTemplate("Later")] + story_for(spec))
    print(f"Generated clean B&W PDF: {out} ({total_pages} halaman)")
    return total_pages
