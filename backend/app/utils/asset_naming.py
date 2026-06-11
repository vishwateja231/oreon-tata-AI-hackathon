"""Helpers for presenting assets by human-readable name in AI output.

The LLM is grounded on raw asset identifiers (e.g. ``Motor_M12``) and tends to
echo them verbatim, which reads like code to an operator. These helpers convert
identifiers to their friendly names (e.g. *Main Rolling Mill Drive*) as a
deterministic post-processing step, so spoken/written answers always read
naturally regardless of what the model emits.
"""

from __future__ import annotations

import re
from typing import Optional

# Matches OREON-style identifiers like ``Motor_M12`` / ``BlastFurnace_BF2``.
_ASSET_ID_RE = re.compile(r"\b[A-Za-z][A-Za-z0-9]*_[A-Za-z0-9]+\b")


def humanize_asset_refs(text: Optional[str], id_to_name: dict[str, str]) -> str:
    """Replace raw asset IDs in ``text`` with their human-readable names.

    Also collapses ``Name (ID)`` and bare ``(ID)`` parentheticals so the result
    never duplicates the name or leaks the identifier.
    """
    if not text:
        return text or ""
    short_codes: set[str] = set()
    # Longest IDs first so e.g. ``Motor_M12`` is handled before any prefix.
    for aid, name in sorted(id_to_name.items(), key=lambda kv: -len(kv[0])):
        if not name or aid == name:
            continue
        # Drop a trailing "(ID)" — whether after the name or standalone.
        text = re.sub(rf"\s*\(\s*{re.escape(aid)}\s*\)", "", text)
        # Swap the bare identifier for the friendly name.
        text = re.sub(rf"\b{re.escape(aid)}\b", name, text)
        # Track the short code suffix the model likes to tack on, e.g. "RM1".
        suffix = aid.split("_")[-1]
        if suffix and suffix != aid:
            short_codes.add(suffix)
    # Strip redundant parenthetical short codes like " (RM1)" / "(G1)".
    for code in sorted(short_codes, key=len, reverse=True):
        text = re.sub(rf"\s*\(\s*{re.escape(code)}\s*\)", "", text)
    # Collapse "Name (Name, extra)" / "Name (Name)" duplications that arise when
    # the model wrote "ID (Name, ...)" and we swapped the ID for the same Name.
    for name in {n for n in id_to_name.values() if n}:
        text = re.sub(rf"({re.escape(name)})\s*\(\s*{re.escape(name)}\s*,\s*", r"\1 (", text)
        text = re.sub(rf"({re.escape(name)})\s*\(\s*{re.escape(name)}\s*\)", r"\1", text)
    return text


def humanize_in_obj(obj, id_to_name: dict[str, str]):
    """Recursively humanize asset IDs inside strings of a list/dict/str structure."""
    if isinstance(obj, str):
        return humanize_asset_refs(obj, id_to_name)
    if isinstance(obj, list):
        return [humanize_in_obj(v, id_to_name) for v in obj]
    if isinstance(obj, dict):
        return {k: humanize_in_obj(v, id_to_name) for k, v in obj.items()}
    return obj
