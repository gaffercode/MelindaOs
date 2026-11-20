from pathlib import Path

from readiness.ai_fill import Residual, ai_fill, build_request, parse_answer, related_docs
from readiness.resolve_facts import Fill
from readiness.scan import scan_text

DOC = """# Jadwal

Jam layanan poli: [ISI].

## Terapi

Oksitosin [ISI] IU intramuskular.

```
[ISI]
```
"""
CONTEXT = [("knowledge/01_HOSPITAL/schedules/x.md", "Poli buka 07.00–14.00 WIB."), ("knowledge/06_CLINICAL_SAFETY/obat.md", "Oksitosin 10 IU intramuskular segera setelah bayi lahir.")]
MODEL = "claude-test"


def placeholders():
    items = scan_text("knowledge/06_CLINICAL_SAFETY/x/kb-klinis-x.md", DOC)
    return {"plain": items[0], "clinical": items[1], "code": items[2]}


def fake(answer):
    calls = []

    def transport(body):
        calls.append(body)
        return {"content": [{"type": "text", "text": "Jawaban:\n" + __import__("json").dumps(answer)}]}

    transport.calls = calls
    return transport


def test_non_clinical_value_becomes_ai_fill():
    p = placeholders()["plain"]
    result = ai_fill(p, DOC, CONTEXT, fake({"value": "07.00–14.00 WIB", "source_ref": "knowledge/01_HOSPITAL/schedules/x.md", "quote": None}), MODEL)
    assert isinstance(result, Fill)
    assert result.value == "07.00–14.00 WIB" and result.method == "ai" and result.model == MODEL
    assert result.source_ref == "knowledge/01_HOSPITAL/schedules/x.md"


def test_invalid_values_are_residuals():
    p = placeholders()["plain"]
    for bad in ["x" * 201, "[ISI]", "", "lihat [CEK: nanti]"]:
        result = ai_fill(p, DOC, CONTEXT, fake({"value": bad, "source_ref": "", "quote": None}), MODEL)
        assert isinstance(result, Residual) and result.reason == "ai_invalid", bad


def test_narrative_and_registry_date_values_are_rejected():
    p = placeholders()["plain"]
    for bad in ["Belum dikonfirmasi; menunggu bukti", "Diisi saat pengesahan oleh Direktur", "Belum"]:
        result = ai_fill(p, DOC, CONTEXT, fake({"value": bad, "source_ref": "d.md", "quote": None}), MODEL)
        assert isinstance(result, Residual) and result.reason == "ai_invalid" and result.detail, bad
    dated = {"value": "28 September 2026", "source_ref": "d.md (front matter governance.date_enacted)", "quote": None}
    result = ai_fill(p, DOC, CONTEXT, fake(dated), MODEL)
    assert isinstance(result, Residual) and result.reason == "ai_invalid"


def test_retry_recovers_from_rate_limit_and_timeout_then_gives_up():
    from readiness.ai_fill import ApiHttpError, with_retry

    attempts = []

    def flaky(body):
        attempts.append(1)
        if len(attempts) == 1:
            raise ApiHttpError(429, "rate limited")
        if len(attempts) == 2:
            raise TimeoutError("slow")
        return {"value": "ok", "source_ref": "", "quote": None}

    waited = []
    send = with_retry(flaky, delays=(0.1, 0.2, 0.3), sleep=waited.append)
    assert send({}) == {"value": "ok", "source_ref": "", "quote": None}
    assert waited == [0.1, 0.2] and len(attempts) == 3

    def forbidden(body):
        raise ApiHttpError(401, "bad key")

    try:
        with_retry(forbidden, delays=(0.1,), sleep=waited.append)({})
        raise AssertionError("401 must not be retried")
    except ApiHttpError as error:
        assert error.status == 401


def test_cek_may_be_confirmed_with_empty_value():
    p = scan_text("d.md", "Unit pemilik: Farmasi [CEK]")[0]
    result = ai_fill(p, "Unit pemilik: Farmasi [CEK]", [], fake({"value": "", "source_ref": "d.md", "quote": None}), MODEL)
    assert isinstance(result, Fill) and result.value == ""


def test_clinical_requires_verbatim_quote_from_cited_file(tmp_path: Path):
    p = placeholders()["clinical"]
    good = {"value": "10", "source_ref": "knowledge/06_CLINICAL_SAFETY/obat.md", "quote": "Oksitosin 10 IU intramuskular"}
    result = ai_fill(p, DOC, CONTEXT, fake(good), MODEL, root=tmp_path)
    assert isinstance(result, Fill) and result.method == "clinical_quote" and result.quote == good["quote"]
    bad = {"value": "10", "source_ref": "knowledge/06_CLINICAL_SAFETY/obat.md", "quote": "Oksitosin 20 IU"}
    result = ai_fill(p, DOC, CONTEXT, fake(bad), MODEL, root=tmp_path)
    assert isinstance(result, Residual) and result.reason == "clinical_unquoted"
    none = {"value": "10", "source_ref": "", "quote": None}
    assert ai_fill(p, DOC, CONTEXT, fake(none), MODEL, root=tmp_path).reason == "clinical_unquoted"


def test_clinical_quote_may_come_from_a_repository_file(tmp_path: Path):
    (tmp_path / "ref").mkdir()
    (tmp_path / "ref/kb-klinis-dosis.md").write_text("Dosis awal oksitosin 10 IU\nintramuskular.", encoding="utf-8")
    p = placeholders()["clinical"]
    answer = {"value": "10", "source_ref": "ref/kb-klinis-dosis.md", "quote": "oksitosin 10 IU intramuskular"}
    result = ai_fill(p, DOC, [], fake(answer), MODEL, root=tmp_path)
    assert isinstance(result, Fill) and result.method == "clinical_quote"


def test_in_code_never_calls_transport():
    p = placeholders()["code"]
    transport = fake({"value": "x", "source_ref": "", "quote": None})
    result = ai_fill(p, DOC, CONTEXT, transport, MODEL)
    assert isinstance(result, Residual) and result.reason == "inside_code"
    assert transport.calls == []


def test_transport_failure_is_api_error():
    def boom(_body):
        raise ConnectionError("down")

    result = ai_fill(placeholders()["plain"], DOC, CONTEXT, boom, MODEL)
    assert isinstance(result, Residual) and result.reason == "api_error"


def test_request_shape_and_answer_parsing():
    p = placeholders()["plain"]
    body = build_request(p, DOC, CONTEXT, MODEL)
    assert body["model"] == MODEL and "Bahasa" not in body["system"] and "JSON" in body["system"]
    assert "Baris 3: Jam layanan poli: [ISI]." in body["messages"][0]["content"]
    assert "=== KONTEKS: knowledge/01_HOSPITAL/schedules/x.md ===" in body["messages"][0]["content"]
    assert parse_answer({"content": [{"type": "text", "text": "tidak ada json"}]}) is None
    assert parse_answer({"value": "a", "source_ref": "b", "quote": None}) == {"value": "a", "source_ref": "b", "quote": None}


def test_related_docs_prefers_same_folder_then_shared_tags(tmp_path: Path):
    for folder, name, tags in [
        ("knowledge/01_HOSPITAL/a", "kb-klinis-self.md", '["poli", "jadwal", "x"]'),
        ("knowledge/01_HOSPITAL/a", "kb-klinis-sibling.md", '["lain"]'),
        ("knowledge/06_CLINICAL_SAFETY/b", "kb-klinis-shared.md", '["poli", "jadwal"]'),
        ("knowledge/06_CLINICAL_SAFETY/b", "kb-klinis-onetag.md", '["poli"]'),
    ]:
        (tmp_path / folder).mkdir(parents=True, exist_ok=True)
        (tmp_path / folder / name).write_text(f"---\ndoc_id: X\ntags: {tags}\n---\n# {name}\n", encoding="utf-8")
    found = related_docs(tmp_path, "knowledge/01_HOSPITAL/a/kb-klinis-self.md")
    assert [rel for rel, _ in found] == ["knowledge/01_HOSPITAL/a/kb-klinis-sibling.md", "knowledge/06_CLINICAL_SAFETY/b/kb-klinis-shared.md"]
