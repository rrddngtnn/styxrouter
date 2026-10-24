#!/usr/bin/env python3
"""Provider inventory: compare declared providers vs actually-used.

Reads the backed-up SQLite (never production) and the installed source
tree to produce a map of:
  - declared providers (registry + executors + oauth + usage + refresh)
  - connected providers (provider_connections rows, redacted)
  - recently-used providers (session_model_history)
  - referenced providers (combos + model_combo_mappings + model_context_overrides)
  - dynamic compatible nodes (openai-compatible-chat-<uuid> aliases)

No secret values are ever emitted; tokens are referenced only by presence/count.
"""
import argparse
import json
from pathlib import Path
import re
import sqlite3
import sys


def _list_dir_stems(path: Path) -> set[str]:
    if not path.is_dir():
        return set()
    return {p.stem for p in path.iterdir() if p.is_file() and p.suffix == ".ts" and not p.stem.startswith("index")}


def _list_dir_names(path: Path) -> set[str]:
    if not path.is_dir():
        return set()
    return {p.name for p in path.iterdir() if p.is_dir()}


def collect(installed_root: Path, db_path: Path) -> dict:
    installed_root = Path(installed_root)
    data = {
        "declared": {
            "registry_dirs": sorted(_list_dir_names(installed_root / "open-sse/config/providers/registry")),
            "executors": sorted(_list_dir_stems(installed_root / "open-sse/executors")),
            "oauth": sorted(_list_dir_stems(installed_root / "src/lib/oauth/providers")),
            "token_refresh": sorted(_list_dir_stems(installed_root / "open-sse/services/tokenRefresh/providers")),
            "usage": sorted(_list_dir_stems(installed_root / "open-sse/services/usage")),
        },
        "connected": {"active_by_provider": {}, "active_by_auth_type": {}, "total_rows": 0,
                      "distinct_providers": 0, "distinct_active_providers": 0},
        "traffic": {"sessions_by_provider": {}, "total_sessions": 0},
        "catalog": {"model_context_overrides_by_provider": {}},
        "combos": {"combo_count": 0, "pattern_mappings": []},
        "dynamic_compatible_nodes": [],
    }
    data["declared"]["registry_dir_count"] = len(data["declared"]["registry_dirs"])
    data["declared"]["executor_count"] = len(data["declared"]["executors"])

    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        # provider_connections (redacted)
        rows = conn.execute(
            "SELECT provider, auth_type, is_active, COUNT(*) "
            "FROM provider_connections GROUP BY provider, auth_type, is_active"
        ).fetchall()
        for provider, auth_type, is_active, n in rows:
            data["connected"]["total_rows"] += n
            if is_active:
                data["connected"]["active_by_provider"][provider] = \
                    data["connected"]["active_by_provider"].get(provider, 0) + n
                data["connected"]["active_by_auth_type"][auth_type] = \
                    data["connected"]["active_by_auth_type"].get(auth_type, 0) + n
        all_providers = {r[0] for r in rows}
        data["connected"]["distinct_providers"] = len(all_providers)
        data["connected"]["distinct_active_providers"] = len(data["connected"]["active_by_provider"])

        # Recent sessions
        rows = conn.execute(
            "SELECT provider, COUNT(*) FROM session_model_history GROUP BY provider ORDER BY COUNT(*) DESC"
        ).fetchall()
        for provider, n in rows:
            data["traffic"]["sessions_by_provider"][provider] = n
            data["traffic"]["total_sessions"] += n

        # Catalog overrides
        rows = conn.execute(
            "SELECT provider, COUNT(*) FROM model_context_overrides GROUP BY provider ORDER BY COUNT(*) DESC"
        ).fetchall()
        for provider, n in rows:
            data["catalog"]["model_context_overrides_by_provider"][provider] = n

        # Combos (data redacted — only extract provider refs)
        combo_count = conn.execute("SELECT COUNT(*) FROM combos").fetchone()[0]
        data["combos"]["combo_count"] = combo_count
        for pattern, combo_id, enabled in conn.execute(
            "SELECT pattern, combo_id, enabled FROM model_combo_mappings"
        ).fetchall():
            data["combos"]["pattern_mappings"].append(
                {"pattern": pattern, "combo_id": combo_id, "enabled": bool(enabled)})
    finally:
        conn.close()

    # Dynamic compatible nodes: provider ids that look like `openai-compatible-chat-<uuid>`
    pattern = re.compile(r"^openai-compatible-chat-[0-9a-f-]{36}$")
    dyn = set()
    for key in data["connected"]["active_by_provider"]:
        if pattern.match(key):
            dyn.add(key)
    for key in data["traffic"]["sessions_by_provider"]:
        if pattern.match(key):
            dyn.add(key)
    for key in data["catalog"]["model_context_overrides_by_provider"]:
        if pattern.match(key):
            dyn.add(key)
    data["dynamic_compatible_nodes"] = sorted(dyn)

    return data


def render(data: dict) -> str:
    declared = data["declared"]
    connected = data["connected"]
    traffic = data["traffic"]
    dyn = data["dynamic_compatible_nodes"]
    active = set(connected["active_by_provider"])
    used = {k for k in traffic["sessions_by_provider"] if k not in dyn}
    catalog = {k for k in data["catalog"]["model_context_overrides_by_provider"] if k not in dyn}
    referenced = active | used | catalog
    static_declared = set(declared["executors"]) | set(declared["oauth"]) | \
                       set(declared["token_refresh"]) | set(declared["usage"]) | \
                       set(declared["registry_dirs"])
    unreferenced_declared = sorted(static_declared - referenced - {"base", "shared", "index"})
    missing_declared = sorted(referenced - static_declared - set(dyn))

    lines = [
        "# Provider reference map",
        "",
        "Read-only snapshot of what StyxRouter declares vs. what the DB shows as",
        "connected / referenced / recently used. No credentials; counts and ids only.",
        "",
        "## Declared surface (code tree)",
        f"- registry subdirs: {declared['registry_dir_count']}",
        f"- executors: {declared['executor_count']}",
        f"- oauth providers: {len(declared['oauth'])}",
        f"- token-refresh providers: {len(declared['token_refresh'])}",
        f"- usage adapters: {len(declared['usage'])}",
        "",
        "## Connected (provider_connections)",
        f"- total rows: {connected['total_rows']}",
        f"- distinct providers: {connected['distinct_providers']}",
        f"- distinct active providers: {connected['distinct_active_providers']}",
        "- active by provider:",
    ]
    for p, n in sorted(connected["active_by_provider"].items(), key=lambda x: -x[1]):
        lines.append(f"  - `{p}` ({n})")
    lines += ["- active by auth_type:"]
    for a, n in sorted(connected["active_by_auth_type"].items(), key=lambda x: -x[1]):
        lines.append(f"  - `{a}` ({n})")
    lines += ["", "## Recent session traffic (session_model_history)",
              f"- total sessions recorded: {traffic['total_sessions']}"]
    for p, n in sorted(traffic["sessions_by_provider"].items(), key=lambda x: -x[1]):
        lines.append(f"- `{p}`: {n}")
    lines += ["", "## Dynamic compatible nodes (openai-compatible-chat-<uuid>)"]
    if not dyn:
        lines.append("- (none)")
    for d in dyn:
        lines.append(f"- `{d}`")
    lines += ["", "## Combos",
              f"- combos row count: {data['combos']['combo_count']}",
              "- pattern mappings:"]
    for m in data["combos"]["pattern_mappings"]:
        lines.append(f"  - `{m['pattern']}` -> `{m['combo_id']}` (enabled={m['enabled']})")
    lines += ["", "## Analysis — pruning candidates (code vs. live reference)",
              "",
              f"- declared providers with ZERO active/traffic/catalog reference: {len(unreferenced_declared)}",
              "- referenced ids NOT in static code tree (likely dynamic): " + str(missing_declared),
              "",
              "Unreferenced-declared sample (first 60):"]
    for p in unreferenced_declared[:60]:
        lines.append(f"- `{p}`")
    if len(unreferenced_declared) > 60:
        lines.append(f"- ... and {len(unreferenced_declared) - 60} more")
    lines += ["", "## Safety notes",
              "- Dynamic compatible nodes resolve via registry glue; keep that path intact even if specific UUIDs come and go.",
              "- Zero-active today != safe to delete tomorrow. User-approved providers (Codex, Antigravity, Kiro, dynamic compatible connectors) must stay regardless of current traffic.",
              "- Any pruning requires: (a) the installed-contract gate re-runs clean against the candidate root, (b) snapshot taken, (c) DB backup fresh.",
              ""]
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--installed-root", type=Path, required=True)
    parser.add_argument("--db-backup", type=Path, required=True)
    parser.add_argument("--output-json", type=Path, required=True)
    parser.add_argument("--output-md", type=Path, required=True)
    args = parser.parse_args()
    try:
        data = collect(args.installed_root, args.db_backup)
    except (sqlite3.Error, OSError) as err:
        print(f"ERROR: {err}", file=sys.stderr)
        return 1
    args.output_json.parent.mkdir(parents=True, exist_ok=True)
    args.output_json.write_text(json.dumps(data, indent=2, sort_keys=True))
    args.output_json.chmod(0o600)
    args.output_md.write_text(render(data))
    args.output_md.chmod(0o600)
    print(f"OK: wrote {args.output_json} and {args.output_md}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
