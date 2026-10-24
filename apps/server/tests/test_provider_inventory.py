import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "provider-inventory.py"
spec = importlib.util.spec_from_file_location("provider_inventory", SCRIPT)
assert spec is not None and spec.loader is not None
pi = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pi)


def _build_installed_root(root: Path) -> Path:
    for sub in ["open-sse/config/providers/registry/codex",
                "open-sse/config/providers/registry/antigravity",
                "open-sse/config/providers/registry/zombie-provider",
                "open-sse/executors",
                "src/lib/oauth/providers",
                "open-sse/services/tokenRefresh/providers",
                "open-sse/services/usage"]:
        (root / sub).mkdir(parents=True)
    (root / "open-sse/executors/codex.ts").write_text("// stub")
    (root / "open-sse/executors/antigravity.ts").write_text("// stub")
    (root / "open-sse/executors/zombie-provider.ts").write_text("// stub")
    (root / "open-sse/executors/index.ts").write_text("// barrel")
    (root / "src/lib/oauth/providers/codex.ts").write_text("// stub")
    (root / "src/lib/oauth/providers/zombie-provider.ts").write_text("// stub")
    (root / "open-sse/services/tokenRefresh/providers/codex.ts").write_text("// stub")
    (root / "open-sse/services/usage/codex.ts").write_text("// stub")
    return root


def _build_db(path: Path) -> None:
    with sqlite3.connect(path) as conn:
        conn.executescript("""
        CREATE TABLE provider_connections (
          id TEXT, provider TEXT, auth_type TEXT, is_active INTEGER
        );
        INSERT INTO provider_connections VALUES
          ('a','codex','oauth',1),
          ('b','antigravity','oauth',1),
          ('c','openai-compatible-chat-11111111-1111-1111-1111-111111111111','apikey',1),
          ('d','retired','oauth',0);
        CREATE TABLE session_model_history (
          id INTEGER, session_id TEXT, provider TEXT
        );
        INSERT INTO session_model_history VALUES
          (1,'s1','codex'), (2,'s2','codex'), (3,'s3','antigravity');
        CREATE TABLE model_context_overrides (
          provider TEXT, model_id TEXT
        );
        INSERT INTO model_context_overrides VALUES
          ('codex','gpt-5'), ('kiro','claude'),
          ('openai-compatible-chat-11111111-1111-1111-1111-111111111111','x');
        CREATE TABLE combos (id TEXT, name TEXT, data TEXT);
        INSERT INTO combos VALUES ('cb1','Muse','{}');
        CREATE TABLE model_combo_mappings (pattern TEXT, combo_id TEXT, enabled INTEGER);
        INSERT INTO model_combo_mappings VALUES ('muse','cb1',1);
        """)
        conn.commit()


class ProviderInventoryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=os.environ["TMPDIR"])
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.installed = _build_installed_root(self.root / "installed")
        self.db = self.root / "store.sqlite"
        _build_db(self.db)

    def test_collect_identifies_active_connections(self):
        data = pi.collect(self.installed, self.db)
        self.assertEqual(data["connected"]["distinct_active_providers"], 3)
        self.assertIn("codex", data["connected"]["active_by_provider"])
        self.assertIn("antigravity", data["connected"]["active_by_provider"])
        self.assertEqual(data["connected"]["active_by_auth_type"]["oauth"], 2)

    def test_dynamic_compatible_nodes_are_detected(self):
        data = pi.collect(self.installed, self.db)
        self.assertEqual(
            data["dynamic_compatible_nodes"],
            ["openai-compatible-chat-11111111-1111-1111-1111-111111111111"])

    def test_render_marks_unreferenced_static_declaration(self):
        data = pi.collect(self.installed, self.db)
        text = pi.render(data)
        self.assertIn("zombie-provider", text)
        self.assertNotIn("Safety notes\n\n- Dynamic compatible nodes resolve", text[-1:])
        self.assertIn("Safety notes", text)
        self.assertIn("Codex, Antigravity, Kiro", text)

    def test_cli_writes_json_and_markdown_with_0600(self):
        out_json = self.root / "out.json"
        out_md = self.root / "out.md"
        rc = os.system(
            f"python3 {SCRIPT} --installed-root {self.installed} "
            f"--db-backup {self.db} --output-json {out_json} --output-md {out_md} >/dev/null"
        )
        self.assertEqual(rc, 0)
        self.assertEqual(oct(out_json.stat().st_mode & 0o777), "0o600")
        self.assertEqual(oct(out_md.stat().st_mode & 0o777), "0o600")
        self.assertEqual(json.loads(out_json.read_text())["connected"]["distinct_active_providers"], 3)


if __name__ == "__main__":
    unittest.main()
