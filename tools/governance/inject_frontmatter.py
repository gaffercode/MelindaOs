#!/usr/bin/env python3
"""
Automated Frontmatter Injector for Melinda Knowledge OS (Domains 01 - 07).
Safely injects standardized YAML frontmatter headers if not present, preserving 100% of original body content.
"""
from pathlib import Path
import re
import sys
import yaml

from legacy_write_guard import require_legacy_overwrite

REPO_ROOT = Path(__file__).resolve().parents[2]

DOMAIN_MAP = {
    "01_HOSPITAL": {
        "authority": "L0_OBSERVE",
        "agents": ["ATLAS", "FLOW", "OPS"],
        "ttl": 30,
        "tools": ["doctor_schedule_query", "bed_capacity_query"],
    },
    "02_PATIENT_ACCESS": {
        "authority": "L1_PREPARE",
        "agents": ["FLOW", "GUARDIAN"],
        "ttl": 30,
        "tools": ["patient_pre_register", "queue_get_status"],
    },
    "03_INSURANCE": {
        "authority": "L1_PREPARE",
        "agents": ["CLAIMS", "FLOW", "LEDGER"],
        "ttl": 60,
        "tools": ["insurance_check_eligibility"],
    },
    "04_BPJS": {
        "authority": "L1_PREPARE",
        "agents": ["CLAIMS", "GUARDIAN", "FLOW"],
        "ttl": 30,
        "tools": ["check_emergency_red_flags", "insurance_check_eligibility"],
    },
    "05_REFERRAL": {
        "authority": "L1_PREPARE",
        "agents": ["FLOW", "GUARDIAN", "CLAIMS"],
        "ttl": 60,
        "tools": ["patient_routing_tree"],
    },
    "06_CLINICAL_SAFETY": {
        "authority": "L5_CLINICAL_ONLY",
        "agents": ["GUARDIAN", "PRISMA", "FLOW"],
        "ttl": 30,
        "tools": ["check_emergency_red_flags"],
    },
    "07_LEGAL_REGULATORY": {
        "authority": "L0_OBSERVE",
        "agents": ["AEGIS", "ATLAS"],
        "ttl": 90,
        "tools": ["auth_health"],
    },
}


def process_file(md_path: Path) -> bool:
    content = md_path.read_text(encoding="utf-8")
    
    # Check if already has frontmatter
    if content.startswith("---"):
        parts = content.split("---", 2)
        if len(parts) >= 3:
            # Already has frontmatter, ensure valid YAML
            try:
                yaml.safe_load(parts[1])
                return False
            except Exception:
                pass

    rel_parts = md_path.relative_to(REPO_ROOT / "knowledge").parts
    domain_folder = rel_parts[0] if rel_parts else "01_HOSPITAL"
    domain_info = DOMAIN_MAP.get(domain_folder, DOMAIN_MAP["01_HOSPITAL"])

    # Extract title from first markdown header
    title = md_path.stem.replace("_", " ").replace("-", " ").title()
    for line in content.splitlines():
        if line.startswith("# "):
            title = line.replace("# ", "").strip()
            break

    doc_id = f"KB-{domain_folder[:2]}-{md_path.stem.upper()[:20]}"
    tags = [domain_folder.lower(), md_path.stem.lower().replace("_", "-")]

    frontmatter = {
        "id": doc_id,
        "title": title,
        "domain": domain_folder,
        "authority_level": domain_info["authority"],
        "target_agents": domain_info["agents"],
        "freshness_ttl_days": domain_info["ttl"],
        "last_verified": "2026-09-28",
        "allowed_tools": domain_info["tools"],
        "tags": tags,
    }

    yaml_header = yaml.dump(frontmatter, sort_keys=False, allow_unicode=True)
    new_content = f"---\n{yaml_header}---\n\n{content.lstrip()}"
    md_path.write_text(new_content, encoding="utf-8")
    return True


def main():
    require_legacy_overwrite(Path(__file__).name, sys.argv[1:])
    target_dirs = ["knowledge/01_HOSPITAL", "knowledge/02_PATIENT_ACCESS", "knowledge/03_INSURANCE", "knowledge/04_BPJS", "knowledge/05_REFERRAL", "knowledge/06_CLINICAL_SAFETY", "knowledge/07_LEGAL_REGULATORY"]
    count = 0
    for td in target_dirs:
        dir_path = REPO_ROOT / td
        if not dir_path.exists():
            continue
        for md_file in dir_path.rglob("*.md"):
            if process_file(md_file):
                count += 1
                print(f"Injected frontmatter: {md_file.relative_to(REPO_ROOT)}")

    print(f"\nFrontmatter injection complete. Updated {count} files.")


if __name__ == "__main__":
    main()
