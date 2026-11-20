from starkes_map import candidates, choose, map_register, r_gaps

INDEX = [
    {"docId": "SPO-IDENTIFIKASI", "title": "Identifikasi Pasien", "tags": "gelang", "category": "A"},
    {"docId": "SPO-JATUH", "title": "Pencegahan Risiko Jatuh", "tags": "", "category": "A"},
    {"docId": "AGENT-RULES", "title": "Identifikasi pasien agent", "tags": "", "category": "B"},
]


def ep(ep_id: str, kinds: list[str], text: str, document_ids: list[str] | None = None) -> dict:
    return {"id": ep_id, "chapterCode": "SKP", "standardCode": "SKP 1", "evidenceKinds": kinds, "text": text,
            "documentIds": document_ids or [], "disposition": "unmapped"}


def test_candidates_use_category_a_titles_only():
    assert candidates(ep("a", ["R"], "Regulasi identifikasi pasien"), INDEX) == ["SPO-IDENTIFIKASI"]


def test_chosen_ids_are_a_subset_of_candidates():
    pool = [INDEX[0], INDEX[1]]
    assert choose(ep("a", ["R"], "x"), pool, lambda _req: ["SPO-JATUH", "INVENTED", "SPO-JATUH"]) == ["SPO-JATUH"]


def test_eps_without_r_are_skipped_and_existing_mappings_kept():
    register = {"requirements": [
        ep("d-only", ["D"], "Bukti identifikasi pasien"),
        ep("kept", ["R"], "Regulasi identifikasi pasien", ["REVIEWED-DOC"]),
        ep("new", ["R"], "Regulasi identifikasi pasien"),
        ep("gap", ["R"], "Regulasi parkir kendaraan"),
    ]}
    rows = map_register(register, INDEX, lambda req: [c["docId"] for c in req["candidates"]])
    by_id = {e["id"]: e for e in register["requirements"]}
    assert by_id["d-only"]["documentIds"] == [] and by_id["kept"]["documentIds"] == ["REVIEWED-DOC"]
    assert by_id["new"]["documentIds"] == ["SPO-IDENTIFIKASI"] and by_id["new"]["disposition"] == "mapped"
    assert [r["epId"] for r in rows] == ["new", "gap"]
    assert r_gaps(register) == {"SKP": ["gap"]}
