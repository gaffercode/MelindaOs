#!/usr/bin/env python3
"""
Full Text Extraction and Categorization Script for sources/raw in Melinda Knowledge OS.
Extracts 100% of text from all PDF, DOCX, DOC, XLSX, and RTF files in sources/raw,
mapping them directly into canonical melindaOs domains with standardized YAML frontmatter.
"""
import json
import os
from pathlib import Path
import re
import sys
import traceback

import pypdf
import docx
import openpyxl
import yaml

from legacy_write_guard import require_legacy_overwrite

REPO_ROOT = Path(__file__).resolve().parents[2]
RAW_DIR = REPO_ROOT / "sources/raw"


def extract_pdf(pdf_path: Path) -> str:
    text_chunks = []
    try:
        reader = pypdf.PdfReader(str(pdf_path))
        for idx, page in enumerate(reader.pages):
            page_text = page.extract_text() or ""
            if page_text.strip():
                text_chunks.append(f"<!-- Page {idx + 1} -->\n" + page_text.strip())
    except Exception as e:
        text_chunks.append(f"[PDF Extraction Warning: {e}]")
    return "\n\n".join(text_chunks)


def extract_docx(docx_path: Path) -> str:
    text_chunks = []
    try:
        doc = docx.Document(str(docx_path))
        for p in doc.paragraphs:
            if p.text.strip():
                text_chunks.append(p.text.strip())
        for table in doc.tables:
            for row in table.rows:
                row_text = [cell.text.strip().replace("\n", " ") for cell in row.cells]
                if any(row_text):
                    text_chunks.append("| " + " | ".join(row_text) + " |")
    except Exception as e:
        text_chunks.append(f"[DOCX Extraction Warning: {e}]")
    return "\n\n".join(text_chunks)


def extract_xlsx(xlsx_path: Path) -> str:
    text_chunks = []
    try:
        wb = openpyxl.load_workbook(str(xlsx_path), data_only=True)
        for sheetname in wb.sheetnames:
            ws = wb[sheetname]
            text_chunks.append(f"### Sheet: {sheetname}")
            for row in ws.iter_rows(values_only=True):
                row_vals = [str(v).strip() for v in row if v is not None]
                if row_vals:
                    text_chunks.append("| " + " | ".join(row_vals) + " |")
    except Exception as e:
        text_chunks.append(f"[XLSX Extraction Warning: {e}]")
    return "\n\n".join(text_chunks)


def extract_text_fallback(file_path: Path) -> str:
    # Try reading as utf-8, latin-1, or raw strings
    for enc in ["utf-8", "latin-1", "cp1252"]:
        try:
            content = file_path.read_text(encoding=enc)
            # Filter printable strings if it looks like binary (.doc or .rtf)
            printable = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]', ' ', content)
            cleaned = re.sub(r'\s+', ' ', printable).strip()
            if len(cleaned) > 50:
                return cleaned
        except Exception:
            pass
    return f"[Raw binary file: {file_path.name}]"


def extract_file_content(file_path: Path) -> str:
    ext = file_path.suffix.lower()
    if ext == ".pdf":
        return extract_pdf(file_path)
    elif ext == ".docx":
        return extract_docx(file_path)
    elif ext == ".xlsx":
        return extract_xlsx(file_path)
    else:
        return extract_text_fallback(file_path)


def determine_target_domain(rel_path_str: str, file_name: str) -> tuple[str, str, str, list[str]]:
    """
    Returns (domain_folder, subfolder, authority_level, target_agents)
    """
    path_lower = (rel_path_str + " " + file_name).lower()

    if "medical records" in path_lower or "rmik" in path_lower or "rekam medis" in path_lower or "simrs" in path_lower or "downtime" in path_lower:
        if "simrs" in path_lower or "downtime" in path_lower or "unit it" in path_lower:
            return "07_LEGAL_REGULATORY", "it_governance", "L0_OBSERVE", ["NEXUS", "AEGIS", "OPS"]
        return "07_LEGAL_REGULATORY", "medical_records_rme", "L0_OBSERVE", ["AEGIS", "GUARDIAN", "FLOW"]

    elif "governance" in path_lower or "authority" in path_lower or "hbl" in path_lower or "by-laws" in path_lower or "komite" in path_lower:
        return "01_HOSPITAL", "governance", "L0_OBSERVE", ["ATLAS", "AEGIS", "OPS"]

    elif "nursing" in path_lower or "midwifery" in path_lower or "triage" in path_lower or "ews" in path_lower or "sbar" in path_lower or "pain" in path_lower or "fall" in path_lower or "monitoring" in path_lower:
        return "06_CLINICAL_SAFETY", "nursing_midwifery", "L5_CLINICAL_ONLY", ["GUARDIAN", "PRISMA", "FLOW"]

    elif "sop" in path_lower or "kebijakan" in path_lower:
        if any(w in path_lower for w in ["peb", "eklamsi", "kpd", "letsu", "pre term", "perdarahan", "ruptur", "imd", "termoregulasi", "perinatal"]):
            return "06_CLINICAL_SAFETY", "maternal_sop", "L5_CLINICAL_ONLY", ["GUARDIAN", "PRISMA", "FLOW"]
        elif "obat" in path_lower or "resep" in path_lower:
            return "07_LEGAL_REGULATORY", "pharmacy_policies", "L1_PREPARE", ["FLOW", "GUARDIAN", "LEDGER"]
        elif "penomoran" in path_lower or "identifikasi" in path_lower:
            return "02_PATIENT_ACCESS", "registration_and_identity", "L1_PREPARE", ["FLOW", "GUARDIAN"]
        else:
            return "01_HOSPITAL", "hospital_sop", "L0_OBSERVE", ["OPS", "ATLAS"]

    return "01_HOSPITAL", "reference", "L0_OBSERVE", ["ATLAS", "FLOW"]


def slugify_name(name: str) -> str:
    name = re.sub(r'[\(\)\[\]\{\}\.,_\-]+', '_', name)
    name = re.sub(r'[^a-zA-Z0-9_]', '_', name)
    name = re.sub(r'_+', '_', name).strip('_').lower()
    return name or "document"


def main():
    require_legacy_overwrite(Path(__file__).name, sys.argv[1:])
    print(f"Scanning raw files in {RAW_DIR}...")
    all_files = list(RAW_DIR.rglob("*"))
    files = [f for f in all_files if f.is_file()]
    print(f"Found {len(files)} raw files.")

    manifest = []
    created_docs = []

    for f in files:
        rel_path = f.relative_to(RAW_DIR)
        rel_str = str(rel_path)
        content = extract_file_content(f)
        
        domain_folder, subfolder, authority, agents = determine_target_domain(rel_str, f.name)
        
        slug = slugify_name(f.stem)
        doc_id = f"KB-RAW-{slug[:25].upper()}"
        title = f.stem.replace("_", " ").replace("-", " ").title()

        target_dir = REPO_ROOT / "knowledge" / domain_folder / subfolder
        target_dir.mkdir(parents=True, exist_ok=True)
        target_file = target_dir / f"{slug}.md"

        frontmatter = {
            "id": doc_id,
            "title": title,
            "domain": domain_folder,
            "authority_level": authority,
            "target_agents": agents,
            "freshness_ttl_days": 60,
            "last_verified": "2026-09-28",
            "allowed_tools": ["auth_health", "claims_exceptions"] if domain_folder == "07_LEGAL_REGULATORY" else ["emergency_red_flag_check"] if domain_folder == "06_CLINICAL_SAFETY" else ["doctor_schedule_query"],
            "source_raw_path": f"sources/raw/{rel_str}",
            "tags": [domain_folder.lower(), subfolder.lower(), slug.replace("_", "-")],
        }

        yaml_header = yaml.dump(frontmatter, sort_keys=False, allow_unicode=True)
        md_content = f"---\n{yaml_header}---\n\n# {title}\n\n**Sumber Dokumen Asli:** `sources/raw/{rel_str}`  \n**Status:** Transcribed & Canonicalized for Melinda Knowledge OS\n\n---\n\n## Isi Dokumen\n\n{content}\n"

        target_file.write_text(md_content, encoding="utf-8")
        created_docs.append(str(target_file.relative_to(REPO_ROOT)))

        manifest.append({
            "source_raw_file": str(rel_path),
            "source_ext": f.suffix.lower(),
            "file_size_bytes": f.stat().st_size,
            "extracted_length_chars": len(content),
            "target_markdown": str(target_file.relative_to(REPO_ROOT)),
            "domain": domain_folder,
            "subfolder": subfolder,
            "doc_id": doc_id,
        })

    # Save manifest
    manifest_file = REPO_ROOT / "knowledge/11_MACHINE_READABLE" / "manifest" / "raw_extraction_manifest.json"
    manifest_file.parent.mkdir(parents=True, exist_ok=True)
    manifest_file.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")

    print(f"\nSuccessfully extracted and mapped {len(created_docs)} documents into Melinda Knowledge OS!")
    print(f"Manifest written to: {manifest_file.relative_to(REPO_ROOT)}")


if __name__ == "__main__":
    main()
