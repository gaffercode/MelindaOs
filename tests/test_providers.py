from pathlib import Path

from melinda_maaf.providers import load_providers, validate_provider_registry


ROOT = Path(__file__).resolve().parents[1]


def _get_providers_path() -> Path:
    candidates = [
        ROOT / 'config' / 'providers.yaml',
        ROOT / 'knowledge/11_MACHINE_READABLE' / 'agentic_config' / 'providers.yaml',
        Path(__file__).resolve().parents[1] / 'knowledge/11_MACHINE_READABLE' / 'agentic_config' / 'providers.yaml',
    ]
    for c in candidates:
        if c.exists():
            return c
    raise FileNotFoundError("providers.yaml not found in candidate paths")


def test_provider_registry_loads_expected_channels():
    registry = load_providers(_get_providers_path())
    assert {'facebook', 'instagram', 'threads', 'linkedin', 'youtube', 'x', 'email', 'website'} <= set(registry)


def test_registry_never_contains_raw_secret_values():
    registry = load_providers(_get_providers_path())
    errors = validate_provider_registry(registry)
    assert errors == []
    for provider in registry.values():
        assert 'access_token' not in provider
        assert 'refresh_token' not in provider
        assert 'client_secret' not in provider
        assert provider['secret_ref'].startswith('vault://')


def test_refresh_metadata_exists_for_oauth_providers():
    registry = load_providers(_get_providers_path())
    for name in ['instagram', 'threads', 'linkedin', 'youtube', 'x']:
        assert 'refresh_strategy' in registry[name]
        assert registry[name]['refresh_strategy']


def test_manual_login_is_not_primary_strategy():
    registry = load_providers(_get_providers_path())
    for provider in registry.values():
        assert provider.get('primary_auth') != 'manual_browser_login'
