from pathlib import Path

from readiness.scan import Placeholder, draft_marker_lines, scan_file, scan_text

SAMPLE = """---
doc_id: "SOP-KLI-X"
---
# Judul

Status: DRAF UNTUK KOREKSI

## 1. Identitas

| Nomor dokumen | [ISI] |
| Jam buka | [ISI jam] s.d. [ISI jam] |
| RS mitra | [CEK: RS mitra] |

```mermaid
flowchart LR
  A[ISI] --> B
```

Lihat contoh `[ISI]` pada template.

## 2. Terapi

Oksitosin [ISI] IU intramuskular.

## 3. Dosis

Parasetamol [ISI] per kali.
"""


def by_line(items: list[Placeholder]) -> dict[int, list[Placeholder]]:
    out: dict[int, list[Placeholder]] = {}
    for item in items:
        out.setdefault(item.line, []).append(item)
    return out


def test_scan_text_finds_plain_and_annotated_forms():
    found = by_line(scan_text("x/kb-klinis-x.md", SAMPLE))
    plain = found[10][0]
    assert plain.kind == "ISI" and plain.hint is None and plain.raw == "[ISI]" and plain.column == 18
    assert plain.doc_path == "x/kb-klinis-x.md"
    assert found[12][0].kind == "CEK" and found[12][0].hint == "RS mitra"


def test_two_placeholders_on_one_line_have_distinct_columns():
    items = by_line(scan_text("d.md", SAMPLE))[11]
    assert [p.hint for p in items] == ["jam", "jam"]
    assert items[0].column < items[1].column
    assert SAMPLE.splitlines()[10][items[1].column:].startswith("[ISI jam]")


def test_placeholder_inside_fence_or_inline_code_is_in_code():
    found = by_line(scan_text("d.md", SAMPLE))
    assert found[16][0].in_code is True
    assert found[19][0].in_code is True
    assert found[10][0].in_code is False


def test_clinical_by_unit_and_by_dosis_heading():
    found = by_line(scan_text("d.md", SAMPLE))
    assert found[23][0].clinical is True and found[23][0].heading == "## 2. Terapi"
    assert found[27][0].clinical is True and found[27][0].heading == "## 3. Dosis"
    assert found[10][0].clinical is False and found[10][0].heading == "## 1. Identitas"


def test_frontmatter_placeholders_are_metadata_not_gaps():
    text = '---\ntitle: "Daftar Koreksi [ISI]/[CEK]"\n---\n# Daftar [ISI]\n'
    items = scan_text("d.md", text)
    assert [(p.line, p.raw) for p in items] == [(4, "[ISI]")]


def test_organisational_unit_is_not_a_dose_unit():
    assert scan_text("d.md", "| Unit pemilik | Farmasi [CEK] |")[0].clinical is False
    assert scan_text("d.md", "Insulin [ISI] unit subkutan")[0].clinical is True
    assert scan_text("d.md", "Insulin 10 unit, ulangi [ISI]")[0].clinical is True


def test_scan_file_and_draft_marker_lines(tmp_path: Path):
    path = tmp_path / "kb-klinis-x.md"
    path.write_text(SAMPLE, encoding="utf-8")
    items = scan_file(path)
    assert len(items) == 8
    assert draft_marker_lines(path) == [6]
