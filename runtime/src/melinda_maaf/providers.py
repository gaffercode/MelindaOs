from pathlib import Path
from typing import Any

import yaml


FORBIDDEN_SECRET_KEYS = {
    "access_token",
    "refresh_token",
    "client_secret",
    "password",
    "api_key",
    "secret",
}


def load_providers(path: str | Path) -> dict[str, dict[str, Any]]:
    data = yaml.safe_load(Path(path).read_text(encoding="utf-8"))
    providers = data.get("providers", {}) if isinstance(data, dict) else {}
    if not isinstance(providers, dict):
        raise ValueError("providers must be a mapping")
    return providers


def validate_provider_registry(registry: dict[str, dict[str, Any]]) -> list[str]:
    errors: list[str] = []
    for name, cfg in registry.items():
        if not isinstance(cfg, dict):
            errors.append(f"{name}: provider config must be a mapping")
            continue
        forbidden = FORBIDDEN_SECRET_KEYS.intersection(cfg)
        if forbidden:
            errors.append(f"{name}: raw secret fields prohibited: {sorted(forbidden)}")
        ref = cfg.get("secret_ref")
        if not isinstance(ref, str) or not ref.startswith("vault://"):
            errors.append(f"{name}: secret_ref must use vault://")
        if cfg.get("primary_auth") == "manual_browser_login":
            errors.append(f"{name}: manual browser login cannot be primary auth")
    return errors
