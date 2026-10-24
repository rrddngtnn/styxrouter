import importlib.util
import os
from pathlib import Path
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "dispatch-policy-gate.py"
spec = importlib.util.spec_from_file_location("dispatch_policy_gate", SCRIPT)
assert spec is not None and spec.loader is not None
dpg = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dpg)


def _build_tree(root: Path, *, fail_closed: bool = False) -> Path:
    executors = root / "open-sse/executors"
    executors.mkdir(parents=True)
    registry_content = 'registerExecutor("codex", codexExec);\nregisterExecutor("kiro", kiroExec);\n'
    (executors / "registry.ts").write_text(registry_content)
    guard = ""
    if fail_closed:
        guard = '  if (!registered) throw new Error("unsupported_provider");\n'
    (executors / "index.ts").write_text(
        'const CHAT_UNSUPPORTED_CLOUD_AGENT_PROVIDERS = new Set(["jules"]);\n'
        'const CHAT_UNSUPPORTED_SEARCH_PROVIDERS = new Set(Object.keys(SEARCH_PROVIDERS));\n'
        'export function getExecutor(provider) {\n'
        '  const registered = getRegisteredExecutor(provider);\n'
        '  if (registered) return registered;\n'
        + guard +
        '  if (!defaultCache.has(provider)) defaultCache.set(provider, new DefaultExecutor(provider));\n'
        '  return defaultCache.get(provider);\n'
        '}\n'
        'export { AntigravityExecutor } from "./antigravity.ts";\n'
        'export { CodexExecutor } from "./codex.ts";\n'
        'export { KiroExecutor } from "./kiro.ts";\n'
    )
    (executors / "default.ts").write_text(
        'super(provider, PROVIDERS[provider] || PROVIDERS.openai);\n'
    )
    for name in ["antigravity", "codex", "kiro"]:
        (executors / f"{name}.ts").write_text(f"// {name} executor stub\n")
    return root


class DispatchPolicyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=os.environ["TMPDIR"])
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def test_open_fallback_detected(self):
        tree = _build_tree(self.root / "open")
        result = dpg.check_dispatch_policy(tree)
        self.assertEqual(result["dispatch_state"], "open_fallback")
        names = {c["name"]: c["pass"] for c in result["checks"]}
        self.assertTrue(names["getExecutor_exists"])
        self.assertTrue(names["cloud_agent_guard_present"])
        self.assertTrue(names["search_provider_guard_present"])
        self.assertTrue(names["openai_fallback_present"])
        self.assertFalse(names["fail_closed_guard_present"])

    def test_fail_closed_detected(self):
        tree = _build_tree(self.root / "closed", fail_closed=True)
        result = dpg.check_dispatch_policy(tree)
        self.assertEqual(result["dispatch_state"], "fail_closed")
        names = {c["name"]: c["pass"] for c in result["checks"]}
        self.assertTrue(names["fail_closed_guard_present"])

    def test_active_providers_have_executors(self):
        tree = _build_tree(self.root / "active")
        result = dpg.check_dispatch_policy(tree)
        names = {c["name"]: c["pass"] for c in result["checks"]}
        for prov in ["antigravity", "codex", "kiro"]:
            self.assertTrue(names[f"active_provider_{prov}_has_executor"],
                            f"{prov} should have executor")

    def test_missing_root_reports_failure(self):
        result = dpg.check_dispatch_policy(self.root / "nope")
        self.assertEqual(result["dispatch_state"], "unknown")
        self.assertFalse(result["checks"][0]["pass"])

    def test_render_produces_markdown(self):
        tree = _build_tree(self.root / "render")
        result = dpg.check_dispatch_policy(tree)
        md = dpg.render(result)
        self.assertIn("open_fallback", md)
        self.assertIn("Provider dispatch policy gate", md)
        self.assertIn("✅", md)


if __name__ == "__main__":
    unittest.main()
