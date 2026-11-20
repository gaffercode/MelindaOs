"""Stage 1: deterministic resolution of role placeholders from the fact registry. No fuzzy guessing."""
from __future__ import annotations

import re
from dataclasses import dataclass

from readiness.facts import EMPLOYEES_CSV, FACTS_JSON, ORG_KB, normalize
from readiness.scan import Placeholder

WINDOW = 40

# Role words (lowercase) → fact key, longest phrase first so "wakil direktur operasional" wins over "direktur".
ROLE_KEYS: list[tuple[str, str]] = [
    ("kepala pelayanan keperawatan & kebidanan", "nursing.head"),
    ("kepala pelayanan keperawatan", "nursing.head"),
    ("kepala keperawatan", "nursing.head"),
    ("wakil direktur sdm & keuangan", "role:wakil direktur sdm & keuangan"),
    ("wakil direktur sdm", "role:wakil direktur sdm & keuangan"),
    ("wadir sdm & keuangan", "role:wakil direktur sdm & keuangan"),
    ("wadir sdm", "role:wakil direktur sdm & keuangan"),
    ("wakil direktur operasional", "role:wakil direktur operasional"),
    ("wadir operasional", "role:wakil direktur operasional"),
    ("staf khusus direktur", "role:staff khusus direktur"),
    ("staff khusus direktur", "role:staff khusus direktur"),
    ("ketua komite medik", "role:komite medik (ketua)"),
    ("kepala instalasi farmasi", "role:farmasi"),
    ("kepala farmasi", "role:farmasi"),
    ("kepala bagian umum", "role:kepala bagian umum / sdm"),
    ("kabag umum", "role:kepala bagian umum / sdm"),
    ("kepala bagian penunjang", "role:kepala bagian penunjang"),
    ("kabag penunjang", "role:kepala bagian penunjang"),
    ("kepala keuangan", "role:kepala keuangan"),
    ("kepala rekam medis", "role:informasi kesehatan & rmik"),
    ("kepala urmik", "role:informasi kesehatan & rmik"),
    ("kepala laboratorium", "role:laboratorium"),
    ("kepala instalasi gizi", "role:gizi"),
    ("direktur utama", "director.name"),
    ("direktur", "director.name"),
]


@dataclass
class Fill:
    placeholder: Placeholder
    value: str
    method: str
    source_ref: str
    quote: str | None
    model: str | None


def _source_ref(key: str) -> str:
    if key.startswith("role:"):
        return f"{ORG_KB}#{key}"
    if key.startswith("employee:"):
        return f"{EMPLOYEES_CSV}#{key}"
    return f"{FACTS_JSON}#{key}"


def resolve_by_fact(p: Placeholder, line_text: str, facts: dict[str, str]) -> Fill | None:
    """Fill an `[ISI]` that directly follows a known role word with the registered name."""
    if p.kind != "ISI" or p.in_code or p.hint:
        return None
    window = line_text[max(0, p.column - WINDOW):p.column]
    lowered = normalize(window)
    for phrase, key in ROLE_KEYS:
        position = lowered.rfind(phrase)
        if position < 0:
            continue
        # An earlier [ISI] between the role word and this one already consumed the role; a [CEK] marker does not.
        if "[isi" in lowered[position + len(phrase):]:
            return None
        value = facts.get(key)
        if not value:
            return None
        return Fill(placeholder=p, value=value, method="fact", source_ref=_source_ref(key), quote=None, model=None)
    return None


def role_pattern() -> re.Pattern[str]:
    return re.compile("|".join(re.escape(phrase) for phrase, _ in ROLE_KEYS), re.IGNORECASE)
