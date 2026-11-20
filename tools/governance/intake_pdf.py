#!/usr/bin/env python3
"""Bring ONE new PDF from sources/raw/ into the knowledge library as a category A draft.

It never overwrites: an existing target stops the run. Without --write it only reports.

    uv run --no-project --python 3.12 --with pyyaml --with jsonschema --with pymupdf --with rapidocr-onnxruntime \\
        python -X utf8 tools/governance/intake_pdf.py "sources/raw/<file>.pdf" \\
        --folder knowledge/01_HOSPITAL/hospital_sop --domain Operasional --department "Farmasi" --title "SPO ..." [--write]

Each page uses its text layer when it has one. A page that is only a picture is read by OCR
(skip with --no-ocr). OCR text is machine reading, not source text: every OCR page is listed as an
anomaly, so the draft gets `review_status: NEEDS_CHIEF_REVIEW` and no governance block, and the
checker fails it until a person has compared those pages with the PDF and corrected them.

After that review, delete the checked `OCR:` / `KOSONG:` lines from the draft's `anomalies`, then:
    intake_pdf.py --recheck <kb file>
It refuses while such a line remains, and on any file that is not an intake draft. Otherwise it
re-runs the quality rules on that one file and adds the governance block only if none fails.
Then refresh the dashboard snapshot (`npm run knowledge-index` in dashboard/) before committing.
"""
from __future__ import annotations

import argparse
import sys
from collections.abc import Callable
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import transform_documents as td
import validate_frontmatter as spec

MIN_TEXT_LAYER = 20  # non-space characters; fewer means the page is a picture
Page = tuple[str, str]  # (text, "teks" | "ocr" | "kosong")


def has_text_layer(text: str) -> bool:
    """A scanner stamp alone is not a text layer."""
    return len("".join(td.strip_boilerplate(text).split())) >= MIN_TEXT_LAYER


def read_pages(pdf: Path, ocr: Callable[[bytes], str] | None) -> list[Page]:
    import pymupdf

    pages: list[Page] = []
    for page in pymupdf.open(pdf):
        text = page.get_text().strip()
        if has_text_layer(text):
            pages.append((text, "teks"))
            continue
        read = ocr(page.get_pixmap(dpi=200).tobytes("png")).strip() if ocr else ""
        pages.append((read, "ocr") if read else ("", "kosong"))
    return pages


def rapid_ocr() -> Callable[[bytes], str]:
    from rapidocr_onnxruntime import RapidOCR

    engine = RapidOCR()

    def read(image: bytes) -> str:
        result, _ = engine(image)
        return "\n".join(line[1] for line in result or [])

    return read


def numbers(pages: list[Page], kind: str) -> str:
    return ", ".join(str(index) for index, (_, source) in enumerate(pages, start=1) if source == kind)


def build_document(pages: list[Page], *, title: str, domain: str, department: str, folder: str, topic: str, source: str, today: str) -> tuple[str, list[str]]:
    """The draft's full text and the anomalies that keep it out of APPROVED."""
    body = "\n\n".join(text.replace("\f", "") for text, _ in pages if text)
    body = td.normalize_headings(td.fix_tables(td.strip_boilerplate(body)), title)
    anomalies: list[str] = []
    if numbers(pages, "ocr"):
        anomalies.append(f"OCR: halaman {numbers(pages, 'ocr')} dibaca mesin dari gambar; cocokkan dengan PDF sumber")
    if numbers(pages, "kosong"):
        anomalies.append(f"KOSONG: halaman {numbers(pages, 'kosong')} tidak terbaca; salin dari PDF sumber")
    anomalies += spec.quality_issues(body, source)
    head = {
        "doc_id": f"SOP-{spec.DOMAINS[domain]}-{topic.upper()}",
        "title": title,
        "domain": domain,
        "department": department,
        "version": "1.0",
        "last_reviewed": today,
        "ftdr_safety_override": domain == "Klinis",
        "tags": td.unique([domain.lower(), td.kebab(department), td.kebab(Path(folder).name), topic]),
    }
    return td.render_a_frontmatter(head, {"source_raw_path": source}, anomalies) + "\n" + body, anomalies


def target_path(root: Path, folder: str, domain: str, topic: str) -> Path:
    if "/".join(Path(folder).parts[:2]) not in spec.KNOWLEDGE_DIRS:
        raise SystemExit(f"--folder harus di dalam folder pengetahuan 01 sampai 07, bukan '{folder}'.")
    return root / folder / f"kb-{domain.lower()}-{topic}.md"


def write_new(target: Path, text: str) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    with open(target, "x", encoding="utf-8", newline="\n") as handle:  # "x": fails if the file exists
        handle.write(text)


def recheck(path: Path) -> int:
    data, _ = td.load_frontmatter(path)
    if data.get("review_status") != "NEEDS_CHIEF_REVIEW":
        raise SystemExit(f"Bukan draf intake (tanpa review_status: NEEDS_CHIEF_REVIEW), tidak disentuh: {path}")
    unread = [str(item) for item in data.get("anomalies") or [] if str(item).startswith(("OCR: halaman", "KOSONG: halaman"))]
    if unread:
        lines = ["Masih ada halaman yang belum dicocokkan orang dengan PDF sumber:", *(f"  - {item}" for item in unread), "Hapus baris itu dari `anomalies` setelah halamannya diperiksa, lalu ulangi."]
        raise SystemExit("\n".join(lines))
    td.refresh_a(path)
    errors = spec.check_a(path)
    print(f"{path}: {'lolos pemeriksa' if not errors else 'BELUM lolos'}")
    for error in errors:
        print(f"  - {error}")
    return 1 if errors else 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("pdf", nargs="?", type=Path, help="the PDF, inside this repository (normally sources/raw/)")
    parser.add_argument("--folder", help="target folder, e.g. knowledge/01_HOSPITAL/hospital_sop")
    parser.add_argument("--domain", choices=sorted(spec.DOMAINS))
    parser.add_argument("--department")
    parser.add_argument("--title")
    parser.add_argument("--topic", help="file-name topic; default: the title in kebab-case")
    parser.add_argument("--no-ocr", action="store_true", help="leave picture-only pages empty instead of reading them by OCR")
    parser.add_argument("--write", action="store_true", help="create the draft (default: report only)")
    parser.add_argument("--recheck", type=Path, metavar="KB_FILE", help="after human review: re-run the quality rules on one draft")
    args = parser.parse_args(argv)

    if args.recheck:
        return recheck(args.recheck.resolve())
    if not (args.pdf and args.folder and args.domain and args.department and args.title):
        parser.error("pdf, --folder, --domain, --department and --title are all required")
    pdf = args.pdf.resolve()
    if not pdf.is_file() or pdf.suffix.lower() != ".pdf":
        raise SystemExit(f"Bukan berkas PDF: {pdf}")
    try:
        source = pdf.relative_to(td.REPO_ROOT.resolve()).as_posix()
    except ValueError:
        raise SystemExit("Letakkan PDF di dalam repositori (sources/raw/) dulu, supaya source_raw_path bisa dilacak.") from None
    topic = td.kebab(args.topic or args.title)
    target = target_path(td.REPO_ROOT, args.folder, args.domain, topic)
    if target.exists():
        raise SystemExit(f"Sudah ada, tidak ditimpa: {target}")

    pages = read_pages(pdf, None if args.no_ocr else rapid_ocr())
    if not any(text for text, _ in pages):
        raise SystemExit("Tidak ada teks yang terbaca dari PDF ini; tidak ada berkas yang dibuat.")
    text, anomalies = build_document(
        pages, title=args.title, domain=args.domain, department=args.department, folder=args.folder,
        topic=topic, source=source, today=date.today().isoformat(),
    )
    print(f"sumber : {source} ({len(pages)} halaman; lapisan teks: {numbers(pages, 'teks') or '-'}; OCR: {numbers(pages, 'ocr') or '-'}; kosong: {numbers(pages, 'kosong') or '-'})")
    print(f"sasaran: {target.relative_to(td.REPO_ROOT).as_posix()}")
    for anomaly in anomalies:
        print(f"  anomali: {anomaly}")
    if not args.write:
        print("Laporan saja. Tambahkan --write untuk membuat berkas.")
        return 0
    write_new(target, text)
    errors = spec.check_a(target)
    print("Berkas dibuat dan lolos pemeriksa." if not errors else "Berkas dibuat. Belum lolos pemeriksa: periksa anomali di atas terhadap PDF sumber, lalu --recheck.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
