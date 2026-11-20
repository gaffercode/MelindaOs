#!/usr/bin/env python3
"""
Download official source documents/landing pages listed in sources.jsonl.
Run from the bundle root:
    python 11_TOOLS/fetch_official_sources.py
"""
from pathlib import Path
import json, hashlib, time
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError

ROOT = Path(__file__).resolve().parents[2] / "knowledge/10_TOOL_CONTRACTS"
SRC = ROOT / "10_MACHINE" / "sources.jsonl"
OUT = ROOT / "raw_sources"
OUT.mkdir(exist_ok=True)

def slug(s):
    import re
    return re.sub(r"[^A-Za-z0-9._-]+", "_", s).strip("_")[:140]

def sha256(data):
    return hashlib.sha256(data).hexdigest()

rows = []
for line in SRC.read_text(encoding="utf-8").splitlines():
    if line.strip():
        rows.append(json.loads(line))

log = []
for item in rows:
    url = item.get("download_url") or item.get("landing_url")
    if not url:
        continue
    ext = ".pdf" if ".pdf" in url.lower() or "download/" in url.lower() else ".html"
    path = OUT / f"{slug(item['id'])}{ext}"
    try:
        req = Request(url, headers={"User-Agent":"Mozilla/5.0 HospitalLicensingKB/1.0"})
        with urlopen(req, timeout=60) as r:
            data = r.read()
            ctype = r.headers.get("Content-Type","")
        if "pdf" in ctype.lower() and path.suffix != ".pdf":
            path = path.with_suffix(".pdf")
        path.write_bytes(data)
        rec = {
            "id": item["id"], "url": url, "file": str(path.relative_to(ROOT)),
            "bytes": len(data), "sha256": sha256(data), "content_type": ctype, "status":"ok"
        }
        print("OK ", item["id"], path.name)
    except (HTTPError, URLError, TimeoutError, Exception) as e:
        rec = {"id":item["id"],"url":url,"status":"error","error":repr(e)}
        print("ERR", item["id"], e)
    log.append(rec)
    time.sleep(0.5)

(ROOT/"12_RESEARCH_LOG"/"download_log.json").write_text(
    json.dumps(log, indent=2, ensure_ascii=False), encoding="utf-8"
)
print("Done. See raw_sources/ and 12_RESEARCH_LOG/download_log.json")
