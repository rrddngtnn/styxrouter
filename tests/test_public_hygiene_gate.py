"""RED-phase tests for scripts/public-hygiene-gate.py.

T1: four tests. Two will fail now because the catalog is empty and the gates
are stubs; T2+ will flip them green.

T1 passing tests:
  - clean fixture passes (empty catalog + stub gates → zero hits → exit 0)
  - gate without --runtime-url marks runtime as skipped

T1 failing tests (RED signal):
  - dirty fixture must fail (currently passes because catalog is empty)
  - allowlist fixture: attribution file passes, src file still fails
    (currently both pass because catalog is empty)
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPT = REPO_ROOT / "scripts" / "public-hygiene-gate.py"
FIX = REPO_ROOT / "tests" / "fixtures" / "hygiene"


def run_gate(repo_root: Path, extra_args: list[str] | None = None) -> subprocess.CompletedProcess:
    with tempfile.TemporaryDirectory() as evidence:
        cmd = [
            sys.executable, "-W", "error::ResourceWarning",
            str(SCRIPT),
            "--repo-root", str(repo_root),
            "--evidence-dir", evidence,
        ] + (extra_args or [])
        proc = subprocess.run(cmd, capture_output=True, text=True)
        # Find and read the report
        reports = list(Path(evidence).glob("*/public-hygiene-report.json"))
        proc.report_path = reports[0] if reports else None
        proc.report_data = json.loads(proc.report_path.read_text()) if proc.report_path else None
        return proc


class HygieneGateT1(unittest.TestCase):
    def test_clean_fixture_passes(self):
        """Clean tree + empty catalog + stub gates → exit 0, no hits."""
        proc = run_gate(FIX / "clean")
        self.assertEqual(proc.returncode, 0, f"stderr: {proc.stderr}")
        self.assertEqual(proc.report_data["overall"], "pass_with_skipped")
        for name, g in proc.report_data["gates"].items():
            self.assertIn(g["status"], ("pass", "skipped"))

    def test_runtime_skipped_when_url_not_passed(self):
        """Without --runtime-url, runtime gate is skipped."""
        proc = run_gate(FIX / "clean")
        self.assertEqual(proc.report_data["gates"]["runtime"]["status"], "skipped")
        self.assertIn("runtime-url", proc.report_data["gates"]["runtime"]["reason"])

    def test_dirty_fixture_fails_RED(self):
        """
        RED: dirty tree has leaks (placeholder user, placeholder IP, 'wave 4', placeholder port, 'nest/gnaw').
        T1 catalog is EMPTY so no hits detected. This test MUST FAIL until T2
        implements the catalog + Gate 1.
        """
        proc = run_gate(FIX / "dirty")
        self.assertEqual(
            proc.returncode, 1,
            f"RED: expected failure but gate passed. Catalog not populated yet? overall={proc.report_data['overall']}",
        )

    def test_allowlist_isolates_hits_to_attribution_section_RED(self):
        """
        RED: with_allowlist fixture has 'OmniRoute' in README.md (allowed, inside
        Credits & lineage section) and in src/something.ts (NOT allowed).
        Gate must pass README but fail src/something.ts. T1 catalog empty → no
        hits detected either way. MUST FAIL until T2 catalog + T5 allowlist.
        """
        proc = run_gate(FIX / "with_allowlist")
        self.assertEqual(
            proc.returncode, 1,
            "RED: expected failure (src/something.ts should hit) but gate passed",
        )
        # Also assert: the hit must land on src/something.ts, NOT on README.md
        hits = proc.report_data["gates"].get("tracked_files", {}).get("hits", [])
        hit_paths = {h["path"] for h in hits}
        self.assertIn(
            "src/something.ts", hit_paths,
            "RED: src/something.ts not detected as a hit",
        )
        self.assertNotIn(
            "README.md", hit_paths,
            "FALSE POSITIVE: README.md should be allowlisted inside Credits & lineage",
        )


class HygieneGateSymlinks(unittest.TestCase):
    def test_symlink_target_is_scanned(self):
        """A tracked symlink stores a path; an absolute home path in it is a leak the gate must see."""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "README.md").write_text("clean\n")
            os.symlink("/home/acmeuser/project/node_modules", root / "deps")  # target need not exist
            proc = run_gate(root)
            self.assertNotEqual(proc.returncode, 0, "a leaking symlink target must fail the gate")
            paths = [h["path"] for g in proc.report_data["gates"].values() for h in g.get("hits", [])]
            self.assertIn("deps", paths)

    def test_harmless_relative_symlink_passes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "README.md").write_text("clean\n")
            os.symlink("../panel/dist", root / "panel")
            self.assertEqual(run_gate(root).returncode, 0)


if __name__ == "__main__":
    unittest.main()
