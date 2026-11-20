import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "dashboard" / "data" / "starkes"
TYPES = {"text", "date", "check", "signature"}


def test_every_ep_has_one_kit_following_its_evidence_kinds():
    register = {ep["id"]: ep for ep in json.loads((DATA / "requirements.json").read_text(encoding="utf-8"))["requirements"]}
    kits = [k for path in sorted((DATA / "kits").glob("*.json")) for k in json.loads(path.read_text(encoding="utf-8"))]
    assert sorted(k["epId"] for k in kits) == sorted(register)
    for k in kits:
        kinds = set(register[k["epId"]]["evidenceKinds"])
        assert (k["form"] is not None) == ("D" in kinds), k["epId"]
        assert (k["photoChecklist"] is not None) == ("O" in kinds), k["epId"]
        assert (k["practice"] is not None) == ("W" in kinds), k["epId"]
        assert k["regulation"]["docIds"] == register[k["epId"]]["documentIds"]
        if k["form"]:
            assert k["form"]["title"] and k["form"]["fields"]
            for field in k["form"]["fields"]:
                assert set(field) == {"label", "type"} and field["type"] in TYPES  # blank: no value key
        for item in k["practice"] or []:
            assert set(item) == {"role", "question", "keyAnswer"} and all(item.values())
