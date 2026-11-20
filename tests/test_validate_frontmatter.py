import importlib.util
import json
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "tools" / "governance" / "validate_frontmatter.py"
_spec = importlib.util.spec_from_file_location("validate_frontmatter", SCRIPT)
vf = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(vf)

GOVERNANCE = (
    "governance:\n"
    "  status: APPROVED\n"
    "  validation_level: CANONICAL\n"
    "  validated_by: dr. Ferdi Andriska, S.H., M.Kn., CMDC\n"
    "  role: Director in Command\n"
    "  date_enacted: '2026-09-28'\n"
    "  enforcement: Strict / Mandatory\n"
)
A_FRONTMATTER = (
    "doc_id: SOP-OPS-CONTOH-UJI\n"
    "title: Contoh Uji\n"
    "domain: Operasional\n"
    "department: Umum\n"
    "version: '1.0'\n"
    "last_reviewed: '2026-10-06'\n"
    "ftdr_safety_override: false\n"
    "tags: [uji]\n"
)
A_BODY = "# Contoh Uji\n\n## Ringkasan\n\nIsi singkat.\n\n| Kolom | Nilai |\n| --- | --- |\n| A | 1 |\n"
B_TAGS = "".join(f"<{tag}>isi {tag}</{tag}>\n" for tag in vf.B_TAGS)
B_FRONTMATTER = "doc_id: AGENT-UJI\ntitle: Agen Uji\nversion: '1.0'\nlast_reviewed: '2026-10-06'\ntags: [uji]\n"


def _write(path: Path, text: str) -> Path:
    path.write_text(text, encoding="utf-8")
    return path


def _a(tmp_path, frontmatter=A_FRONTMATTER + GOVERNANCE, body=A_BODY):
    return _write(tmp_path / "kb-operasional-contoh-uji.md", f"---\n{frontmatter}---\n{body}")


def _b(tmp_path, tags=B_TAGS):
    return _write(
        tmp_path / "agent-uji-rules.prompt.md",
        f"---\n{B_FRONTMATTER}{GOVERNANCE}---\n<agent_specification>\n{tags}</agent_specification>\n",
    )


def _schema(**overrides):
    schema = {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "description": "Entitas uji.",
        "properties": {"kode": {"type": "string", "description": "Kode entitas.", "pattern": "^[A-Z]+$"}},
        "required": ["kode"],
        "governance": {key: value for key, value in vf.GOVERNANCE_FIELDS.items()},
    }
    schema.update(overrides)
    return {key: value for key, value in schema.items() if value is not None}


def _c(tmp_path, schema):
    return _write(tmp_path / "schema-uji.json", json.dumps(schema))


def _has(errors, prefix):
    return any(error.startswith(prefix) for error in errors)


def test_minimal_valid_documents_pass(tmp_path):
    assert vf.check_a(_a(tmp_path)) == []
    assert vf.check_b(_b(tmp_path)) == []
    assert vf.check_c(_c(tmp_path, _schema())) == []


@pytest.mark.parametrize("field", vf.A_REQUIRED)
def test_category_a_missing_required_field_fails(tmp_path, field):
    frontmatter = "".join(line + "\n" for line in A_FRONTMATTER.splitlines() if not line.startswith(f"{field}:"))

    errors = vf.check_a(_a(tmp_path, frontmatter=frontmatter + GOVERNANCE))

    assert any(error.startswith("FRONTMATTER: field wajib hilang") and field in error for error in errors)


def test_changed_governance_date_enacted_fails(tmp_path):
    governance = GOVERNANCE.replace("'2026-09-28'", "'2026-10-06'")

    errors = vf.check_a(_a(tmp_path, frontmatter=A_FRONTMATTER + governance))

    assert "GOVERNANCE: governance.date_enacted harus '2026-09-28'" in errors


def test_table_without_separator_row_fails(tmp_path):
    body = A_BODY.replace("| --- | --- |\n", "")

    assert _has(vf.check_a(_a(tmp_path, body=body)), "TABEL: baris pemisah")


def test_placeholder_or_draft_marker_on_approved_document_fails(tmp_path):
    assert _has(vf.check_a(_a(tmp_path, body=A_BODY + "\nNomor SK: [ISI nomor SK].\n")), "placeholder_on_approved")
    assert _has(vf.check_a(_a(tmp_path, body=A_BODY + "\nStatus: DRAF UNTUK KOREKSI\n")), "placeholder_on_approved")
    inside_code = A_BODY + "\nContoh penanda `[ISI]` dan blok:\n\n```\n[CEK]\n```\n"
    assert not _has(vf.check_a(_a(tmp_path, body=inside_code)), "placeholder_on_approved")
    draft = GOVERNANCE.replace("status: APPROVED", "status: DRAF")
    assert not _has(vf.check_a(_a(tmp_path, frontmatter=A_FRONTMATTER + draft, body=A_BODY + "\n[ISI]\n")), "placeholder_on_approved")


def test_placeholders_recorded_as_director_items_are_accepted(tmp_path):
    residuals = tmp_path / vf.RESIDUALS_FILE
    residuals.parent.mkdir(parents=True)
    rows = [{"docPath": "kb-operasional-contoh-uji.md", "line": 9, "placeholder": "[ISI nomor SK]", "reason": "director", "detail": "nomor SK"}]
    residuals.write_text(json.dumps(rows), encoding="utf-8")
    recorded = A_BODY + "\nNomor SK: [ISI nomor SK].\n\nStatus: DRAF UNTUK KOREKSI\n"
    assert not _has(vf.check_a(_a(tmp_path, body=recorded), root=tmp_path), "placeholder_on_approved")
    extra = recorded + "\nTanggal: [ISI].\n"
    errors = vf.check_a(_a(tmp_path, body=extra), root=tmp_path)
    assert _has(errors, "placeholder_on_approved: 1 placeholder")
    assert _has(vf.check_a(_a(tmp_path, body=recorded)), "placeholder_on_approved")  # another root: nothing recorded


def test_nik_like_number_is_flagged_as_pii(tmp_path):
    body = A_BODY + "\nNIK pasien 3506012345678901.\n"

    assert _has(vf.check_a(_a(tmp_path, body=body)), "PII:")


@pytest.mark.parametrize("tag", vf.B_TAGS)
def test_category_b_missing_xml_tag_fails(tmp_path, tag):
    tags = B_TAGS.replace(f"<{tag}>isi {tag}</{tag}>\n", "")

    assert f"XML: <{tag}> harus dibuka dan ditutup tepat sekali" in vf.check_b(_b(tmp_path, tags=tags))


def test_category_c_schema_without_required_fails(tmp_path):
    assert "SCHEMA: required kosong" in vf.check_c(_c(tmp_path, _schema(required=None)))
