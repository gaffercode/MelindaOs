"""Stage 2+3: AI best guess through the Claude Messages API, with the clinical-number quote guard."""
from __future__ import annotations

import json
import os
import re
import time
import urllib.error
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from readiness.resolve_facts import Fill
from readiness.scan import PLACEHOLDER, REPO_ROOT, Placeholder, category_a_files

API_URL = "https://api.anthropic.com/v1/messages"
API_VERSION = "2023-06-01"
DEFAULT_MODEL = "claude-sonnet-5-5"
MODEL_ENV = "MELINDAOS_READINESS_MODEL"
KEY_ENV = "ANTHROPIC_API_KEY"
MAX_VALUE_LEN = 200
MAX_CONTEXT_CHARS = 12_000
TIMEOUT_SECONDS = 60

Reason = Literal["inside_code", "ai_invalid", "clinical_unquoted", "api_error", "director"]
SESSION_METHOD = "session"
SESSION_MODEL = "claude-fable-5-1 (Claude Code session)"

SYSTEM_PROMPT = (
    "Anda membantu RSIA Melinda DHAI (Kediri) melengkapi dokumen tata kelola dan klinis. "
    "Isi SATU nilai paling mungkin untuk placeholder yang ditunjuk, berdasarkan dokumen itu sendiri dan dokumen konteks "
    "RSIA Melinda DHAI. Jangan mengarang nama orang, nomor surat, atau angka. "
    "Placeholder [ISI] berarti nilai yang harus diisi; placeholder [CEK] berarti pernyataan sebelumnya perlu dikonfirmasi: "
    "balas value string kosong bila pernyataan sudah benar, atau teks koreksi singkat bila perlu diperbaiki. "
    "Untuk angka klinis (dosis, satuan mg/mL/IU/mmHg dan sejenisnya) WAJIB mengutip kalimat persis dari dokumen konteks "
    "pada field quote dan menyebut path dokumen itu pada source_ref; bila tidak ada kutipan, balas value kosong. "
    "Jika nilai tidak dapat dipastikan dari dokumen atau konteks, balas value kosong (\"\"). "
    "value HANYA berisi nilai akhir yang akan dicetak di dokumen: jangan pernah menulis keterangan, status "
    "('belum', 'menunggu'), instruksi, atau penjelasan sebagai value. "
    "governance.date_enacted pada frontmatter adalah konstanta registri, bukan tanggal terbit/berlaku dokumen; "
    "jangan memakainya untuk mengisi tanggal. Kolom tanda tangan dan tanggal pengesahan diisi manusia: balas value kosong. "
    "Nilai maksimal 200 karakter, tanpa placeholder baru. "
    'Jawab HANYA dengan JSON: {"value": string, "source_ref": string, "quote": string|null}.'
)

# Narrative non-answers the model may still write as a value; a document cell never holds these.
META_VALUE = re.compile(
    r"\b(belum|menunggu|perlu (?:di)?konfirmasi|perlu dicek|harus dicek|tidak tercantum|tidak ada di dokumen|"
    r"tidak (?:dapat|bisa) dikonfirmasi|diisi (?:saat|oleh|dari)|jangan ditebak|ambil dari|status dokumen|"
    r"draf untuk koreksi|dikonfirmasi|konfirmasi|tidak diketahui|belum ditetapkan)\b",
    re.IGNORECASE,
)
REGISTRY_DATE_REF = re.compile(r"date_enacted", re.IGNORECASE)


@dataclass
class Residual:
    placeholder: Placeholder
    reason: Reason
    detail: str | None = None


def model_name() -> str:
    return os.environ.get(MODEL_ENV) or DEFAULT_MODEL


def _frontmatter_tags(text: str) -> set[str]:
    match = re.search(r"^tags:\s*\[(.*?)\]", text, re.M)
    if not match:
        return set()
    return {t.strip().strip('"\'') for t in match.group(1).split(",") if t.strip()}


def related_docs(root: Path, doc_path: str, limit: int = 4) -> list[tuple[str, str]]:
    """Same-folder Category A docs first, then docs sharing at least two frontmatter tags."""
    own = root / doc_path
    own_text = own.read_text(encoding="utf-8") if own.exists() else ""
    own_tags = _frontmatter_tags(own_text)
    same_folder: list[tuple[str, str]] = []
    by_tags: list[tuple[int, str, str]] = []
    for path in category_a_files(root):
        rel = path.relative_to(root).as_posix()
        if rel == doc_path:
            continue
        text = path.read_text(encoding="utf-8")
        if path.parent == own.parent:
            same_folder.append((rel, text))
            continue
        shared = len(own_tags & _frontmatter_tags(text))
        if shared >= 2:
            by_tags.append((shared, rel, text))
    by_tags.sort(key=lambda item: (-item[0], item[1]))
    chosen = same_folder + [(rel, text) for _, rel, text in by_tags]
    return [(rel, text[:MAX_CONTEXT_CHARS]) for rel, text in chosen[:limit]]


def build_request(p: Placeholder, doc_text: str, context_docs: list[tuple[str, str]], model: str) -> dict:
    lines = doc_text.splitlines()
    line_text = lines[p.line - 1] if 0 < p.line <= len(lines) else ""
    context = "\n\n".join(f"=== KONTEKS: {rel} ===\n{text}" for rel, text in context_docs)
    user = (
        f"Dokumen: {p.doc_path}\n"
        f"Baris {p.line}: {line_text}\n"
        f"Placeholder: {p.raw} (jenis {p.kind}{', petunjuk: ' + p.hint if p.hint else ''})\n"
        f"Heading terdekat: {p.heading or '-'}\n"
        f"Klinis: {'ya' if p.clinical else 'tidak'}\n\n"
        f"=== DOKUMEN ===\n{doc_text[:MAX_CONTEXT_CHARS]}\n\n{context}"
    )
    return {
        "model": model,
        "max_tokens": 400,
        "system": SYSTEM_PROMPT,
        "messages": [{"role": "user", "content": user}],
    }


def parse_answer(response: dict) -> dict | None:
    """Pull the JSON object out of a Messages API response (or a bare answer dict from a fake transport)."""
    if "value" in response and "content" not in response:
        return response
    text = ""
    for block in response.get("content", []):
        if isinstance(block, dict) and block.get("type") == "text":
            text += block.get("text", "")
    match = re.search(r"\{.*\}", text, re.S)
    if not match:
        return None
    try:
        answer = json.loads(match.group(0))
    except json.JSONDecodeError:
        return None
    return answer if isinstance(answer, dict) else None


def _quote_in_file(quote: str, source_ref: str, context_docs: list[tuple[str, str]], root: Path) -> bool:
    if not quote or not source_ref:
        return False
    ref = source_ref.split("#", 1)[0].strip()
    texts = [text for rel, text in context_docs if rel == ref]
    candidate = root / ref
    if not texts and candidate.is_file() and candidate.resolve().is_relative_to(root.resolve()):
        texts = [candidate.read_text(encoding="utf-8")]
    squeeze = lambda s: re.sub(r"\s+", " ", s).strip()  # noqa: E731
    return any(quote in text or squeeze(quote) in squeeze(text) for text in texts)


def ai_fill(
    p: Placeholder,
    doc_text: str,
    context_docs: list[tuple[str, str]],
    transport: Callable[[dict], dict],
    model: str,
    root: Path = REPO_ROOT,
) -> Fill | Residual:
    if p.in_code:
        return Residual(p, "inside_code")
    try:
        response = transport(build_request(p, doc_text, context_docs, model))
    except Exception as error:  # noqa: BLE001 - any transport failure is an api_error residual
        return Residual(p, "api_error", f"{type(error).__name__}: {str(error)[:400]}")
    answer = parse_answer(response) if isinstance(response, dict) else None
    if answer is None:
        return Residual(p, "ai_invalid", "no JSON answer")
    return check_value(p, answer.get("value"), answer.get("source_ref"), answer.get("quote"), "ai", model, context_docs, root)


def check_value(
    p: Placeholder,
    value: object,
    source_ref: object,
    quote: object,
    method: str,
    model: str | None,
    context_docs: list[tuple[str, str]],
    root: Path,
) -> Fill | Residual:
    """The same acceptance rules for every author of a value: the API model or the Claude Code session."""
    source_ref = str(source_ref or "").strip()
    quote = str(quote).strip() if quote else None
    if not isinstance(value, str):
        return Residual(p, "ai_invalid", "value is not a string")
    value = value.strip()
    if len(value) > MAX_VALUE_LEN or PLACEHOLDER.search(value) or (not value and p.kind == "ISI"):
        return Residual(p, "ai_invalid", "empty, too long or contains a placeholder")
    if value and META_VALUE.search(value):
        return Residual(p, "ai_invalid", f"narrative value: {value[:80]}")
    if value and REGISTRY_DATE_REF.search(source_ref):
        return Residual(p, "ai_invalid", "value derived from governance.date_enacted")
    if p.clinical:
        if not _quote_in_file(quote or "", source_ref, context_docs, root):
            return Residual(p, "clinical_unquoted")
        return Fill(p, value, "clinical_quote", source_ref, quote, model)
    return Fill(p, value, method, source_ref or p.doc_path, quote, model)


RETRY_DELAYS = (2.0, 5.0, 12.0)


class ApiHttpError(Exception):
    def __init__(self, status: int, body: str):
        super().__init__(f"HTTP {status}: {body[:400]}")
        self.status = status


def with_retry(send_once: Callable[[dict], dict], delays: tuple[float, ...] = RETRY_DELAYS, sleep: Callable[[float], None] = time.sleep) -> Callable[[dict], dict]:
    """Retry rate limits (429), overload/server errors (5xx) and network timeouts with fixed backoff."""

    def send(body: dict) -> dict:
        attempt = 0
        while True:
            try:
                return send_once(body)
            except ApiHttpError as error:
                retryable = error.status == 429 or error.status >= 500
                if not retryable or attempt >= len(delays):
                    raise
            except (urllib.error.URLError, TimeoutError, OSError):
                if attempt >= len(delays):
                    raise
            sleep(delays[attempt])
            attempt += 1

    return send


def http_transport(api_key: str, timeout: int = TIMEOUT_SECONDS) -> Callable[[dict], dict]:
    """Real transport: POST to the Claude Messages API with retry. The key is never logged."""

    def send_once(body: dict) -> dict:
        request = urllib.request.Request(
            API_URL,
            data=json.dumps(body).encode("utf-8"),
            headers={"content-type": "application/json", "x-api-key": api_key, "anthropic-version": API_VERSION},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310 - fixed https URL
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            raise ApiHttpError(error.code, error.read().decode("utf-8", "replace")) from None

    return with_retry(send_once)


def api_key_from_env() -> str | None:
    return os.environ.get(KEY_ENV) or None
