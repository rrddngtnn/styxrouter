import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "installed-contracts.py"
spec = importlib.util.spec_from_file_location("installed_contracts", SCRIPT)
assert spec is not None and spec.loader is not None
ic = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ic)


class ContractTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=os.environ["TMPDIR"])
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.chunks = self.root / "dist/.build/next/server/chunks"
        self.chunks.mkdir(parents=True)
        self.patched = self.chunks / "_1l6l9wn._.js"
        self.patched.write_text(
            'noise;"codex"===rz&&!rq&&"context-relay"!==rw&&'
            '(429===m.response.status||400===m.response.status&&'
            '(await m.response.clone().text().catch(()=>"")).includes'
            '("model is not supported when using Codex with a ChatGPT account"))'
            '&&o<i-1;more'
        )
        self.unmodified = self.chunks / "normal.js"
        self.unmodified.write_text("plain file no anchors here")

    def test_patch_anchor_present_passes(self):
        contracts = [{"name": "codex-chatgpt-400", "file": str(self.patched),
                      "must_contain": ['model is not supported when using Codex with a ChatGPT account',
                                       '400===m.response.status']}]
        failures = ic.check(self.root, contracts)
        self.assertEqual(failures, [])

    def test_missing_anchor_reports_failure(self):
        contracts = [{"name": "codex-chatgpt-400", "file": str(self.unmodified),
                      "must_contain": ['model is not supported when using Codex with a ChatGPT account']}]
        failures = ic.check(self.root, contracts)
        self.assertEqual(len(failures), 1)
        self.assertIn("codex-chatgpt-400", failures[0])
        self.assertIn("missing", failures[0].lower())

    def test_missing_file_reports_failure(self):
        contracts = [{"name": "nope", "file": str(self.root / "does/not/exist.js"),
                      "must_contain": ["anything"]}]
        failures = ic.check(self.root, contracts)
        self.assertEqual(len(failures), 1)
        self.assertIn("nope", failures[0])

    def test_hash_contract_enforces_exact_bytes(self):
        sha = hashlib.sha256(self.patched.read_bytes()).hexdigest()
        contracts = [{"name": "pinned-chunk", "file": str(self.patched),
                      "sha256": sha}]
        self.assertEqual(ic.check(self.root, contracts), [])
        self.patched.write_text("tampered")
        failures = ic.check(self.root, contracts)
        self.assertEqual(len(failures), 1)
        self.assertIn("sha256", failures[0])

    def test_must_not_contain_rejects_regression(self):
        contracts = [{"name": "no-plaintext-secret", "file": str(self.patched),
                      "must_not_contain": ["AKIA", "BEGIN PRIVATE KEY"]}]
        self.assertEqual(ic.check(self.root, contracts), [])
        self.patched.write_text(self.patched.read_text() + " AKIA_LEAK_SIM")
        failures = ic.check(self.root, contracts)
        self.assertEqual(len(failures), 1)
        self.assertIn("forbidden", failures[0].lower())


if __name__ == "__main__":
    unittest.main()
