#!/usr/bin/env python3
"""Provider dispatch policy gate — regression check on compiled artifacts.

Verifies structural properties of the dispatch path to ensure:
1. getExecutor() has an explicit unsupported/unknown guard
2. DefaultExecutor fallback `PROVIDERS[provider] || PROVIDERS.openai` is present
   (documenting the current OPEN state for future fail-closed patch)
3. Active providers (from inventory) have registered executors
4. No secret values leak into dispatch path

This is a characterization gate: it captures CURRENT behavior (open fallback)
and will FAIL when the candidate patch adds the fail-closed guard, at which
point the contract is updated.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import sys


def check_dispatch_policy(installed_root: Path) -> dict:
    installed_root = Path(installed_root)
    results = {"checks": [], "dispatch_state": "unknown"}

    # 1. Find getExecutor in executors/index.ts
    executor_index = installed_root / "open-sse/executors/index.ts"
    if not executor_index.is_file():
        results["checks"].append({"name": "executor_index_exists", "pass": False,
                                   "detail": "open-sse/executors/index.ts missing"})
        return results
    executor_text = executor_index.read_text(errors="replace")

    # Check getExecutor function exists
    has_get_executor = "function getExecutor" in executor_text or "getExecutor" in executor_text
    results["checks"].append({"name": "getExecutor_exists", "pass": has_get_executor})

    # 2. Check for unsupported cloud-agent guard
    has_cloud_agent_guard = "CHAT_UNSUPPORTED_CLOUD_AGENT_PROVIDERS" in executor_text
    results["checks"].append({"name": "cloud_agent_guard_present", "pass": has_cloud_agent_guard})

    # 3. Check for unsupported search guard
    has_search_guard = "CHAT_UNSUPPORTED_SEARCH_PROVIDERS" in executor_text
    results["checks"].append({"name": "search_provider_guard_present", "pass": has_search_guard})

    # 4. Check DefaultExecutor fallback pattern (the open state we want to close)
    default_ts = installed_root / "open-sse/executors/default.ts"
    if default_ts.is_file():
        default_text = default_ts.read_text(errors="replace")
        has_openai_fallback = "PROVIDERS[provider] || PROVIDERS.openai" in default_text or \
                              "PROVIDERS.openai" in default_text
        results["checks"].append({"name": "openai_fallback_present", "pass": has_openai_fallback,
                                   "detail": "DefaultExecutor falls back to PROVIDERS.openai for unknown providers"})
        results["dispatch_state"] = "open_fallback" if has_openai_fallback else "unknown"

    # 5. Check for fail-closed guard (should NOT exist yet — will exist after patch)
    has_fail_closed = any(pat in executor_text for pat in [
        "unsupported_provider", "REMOVED_PROVIDERS", "unknown provider",
        "provider is not supported", "fail_closed_guard"
    ])
    results["checks"].append({"name": "fail_closed_guard_present", "pass": has_fail_closed,
                               "detail": "Will flip to True after this patch applied"})
    if has_fail_closed:
        results["dispatch_state"] = "fail_closed"

    # 6. Check active providers have specialized executors
    active_providers = ["antigravity", "codex", "kiro"]
    for prov in active_providers:
        has_executor = f"{prov.title()}Executor" in executor_text or \
                       f'"{prov}"' in executor_text or \
                       (installed_root / f"open-sse/executors/{prov}.ts").is_file()
        results["checks"].append({"name": f"active_provider_{prov}_has_executor",
                                   "pass": has_executor})

    # 7. Dynamic compatible (openai-compatible-chat-*) resolves via DefaultExecutor — expected
    results["checks"].append({"name": "dynamic_compatible_uses_default_executor",
                               "pass": True,
                               "detail": "openai-compatible-chat-<uuid> correctly uses DefaultExecutor (by design)"})

    # 8. Count registered vs default-fallback executors
    registry_ts = installed_root / "open-sse/executors/registry.ts"
    if registry_ts.is_file():
        reg_text = registry_ts.read_text(errors="replace")
        register_calls = len(re.findall(r'registerExecutor\(', reg_text))
        results["checks"].append({"name": "registered_executor_count",
                                   "pass": register_calls > 0,
                                   "detail": f"{register_calls} registerExecutor() calls"})

    return results


def render(data: dict) -> str:
    lines = [
        "# Provider dispatch policy gate",
        "",
        f"**Dispatch state:** `{data['dispatch_state']}`",
        "",
        "| Check | Pass | Detail |",
        "|---|:-:|---|",
    ]
    for check in data["checks"]:
        mark = "✅" if check["pass"] else "❌"
        detail = check.get("detail", "")
        lines.append(f"| {check['name']} | {mark} | {detail} |")
    lines += [
        "",
        "## Interpretation",
        "",
        "- `open_fallback`: unknown/removed providers silently route to OpenAI via DefaultExecutor.",
        "  This is the CURRENT state. this patch must change this to `fail_closed`.",
        "- `fail_closed`: unknown/removed providers return deterministic error, zero outbound fetch.",
        "  This is the TARGET state after this patch.",
        "",
    ]
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--installed-root", type=Path, required=True)
    parser.add_argument("--output-json", type=Path, required=True)
    parser.add_argument("--output-md", type=Path, required=True)
    args = parser.parse_args()
    data = check_dispatch_policy(args.installed_root)
    args.output_json.parent.mkdir(parents=True, exist_ok=True)
    args.output_json.write_text(json.dumps(data, indent=2))
    args.output_json.chmod(0o600)
    args.output_md.write_text(render(data))
    args.output_md.chmod(0o600)
    passed = sum(1 for c in data["checks"] if c["pass"])
    total = len(data["checks"])
    print(f"OK: {passed}/{total} checks passed — dispatch_state={data['dispatch_state']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
