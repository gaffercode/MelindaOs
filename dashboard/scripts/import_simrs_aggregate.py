"""Import a Medify aggregate export into dashboard/data/simrs."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "runtime" / "src"))

from melinda_maaf.simrs_aggregate import main

if __name__ == "__main__":
    raise SystemExit(main())
