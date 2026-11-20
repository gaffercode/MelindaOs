from __future__ import annotations

from functools import lru_cache
from pathlib import Path

import yaml

ACTOR_ROLES = frozenset({"ALL_ACCESS"})
RISK_CLASSES = frozenset({"L0", "L1", "L2", "L3", "L4", "L5"})
CONTRACT_PATH = Path(__file__).resolve().parents[3] / "knowledge/10_TOOL_CONTRACTS" / "mcp" / "tool-contracts.yaml"


class _UniqueKeyLoader(yaml.SafeLoader):
    def construct_mapping(self, node, deep=False):
        if isinstance(node, yaml.MappingNode):
            self.flatten_mapping(node)
            seen = set()
            for key_node, _ in node.value:
                key = self.construct_object(key_node, deep=deep)
                try:
                    duplicate = key in seen
                    seen.add(key)
                except TypeError as error:
                    raise yaml.constructor.ConstructorError(
                        "while constructing a mapping",
                        node.start_mark,
                        "found unhashable key",
                        key_node.start_mark,
                    ) from error
                if duplicate:
                    raise yaml.constructor.ConstructorError(
                        "while constructing a mapping",
                        node.start_mark,
                        f"found duplicate key {key!r}",
                        key_node.start_mark,
                    )
        return super().construct_mapping(node, deep=deep)


def _load_tools(path: Path) -> list | None:
    try:
        document = yaml.load(path.read_text(encoding="utf-8"), Loader=_UniqueKeyLoader)
    except (OSError, UnicodeError, yaml.YAMLError):
        return None
    if not isinstance(document, dict) or not isinstance(document.get("tools"), list):
        return None
    return document["tools"]


@lru_cache(maxsize=4)
def load_tool_contracts(path: Path = CONTRACT_PATH) -> dict[str, frozenset[str]] | None:
    """Load the complete role-to-tool map, failing closed on any invalid entry."""
    tools = _load_tools(path)
    if tools is None:
        return None

    grants: dict[str, frozenset[str]] = {}
    for item in tools:
        if not isinstance(item, dict):
            return None
        name = item.get("name")
        roles = item.get("allowed_roles")
        if not isinstance(name, str) or not name.strip() or name in grants:
            return None
        if roles == "all" or roles == ["*"]:
            grants[name] = ACTOR_ROLES
            continue
        if not isinstance(roles, list):
            return None
        if any(not isinstance(role, str) or role not in ACTOR_ROLES for role in roles):
            return None
        if len(set(roles)) != len(roles):
            return None
        grants[name] = frozenset(roles)
    return grants


def allowed_roles_for(tool: str) -> frozenset[str] | None:
    """Return an explicit grant set; unknown or invalid contracts deny access."""
    if not isinstance(tool, str) or not tool.strip():
        return None
    grants = load_tool_contracts()
    if grants is None:
        return None
    return grants.get(tool)


@lru_cache(maxsize=4)
def load_tool_risks(path: Path = CONTRACT_PATH) -> dict[str, str] | None:
    """Map each tool to its contract risk class; tools without a valid L0-L5 risk are omitted."""
    if load_tool_contracts(path) is None:
        return None
    return {item["name"]: item["risk"] for item in _load_tools(path) if isinstance(item.get("risk"), str) and item["risk"] in RISK_CLASSES}


def risk_for(tool: str) -> str | None:
    """Return the contract risk class; unknown tools or invalid contracts yield None."""
    if not isinstance(tool, str) or not tool.strip():
        return None
    risks = load_tool_risks()
    if risks is None:
        return None
    return risks.get(tool)
