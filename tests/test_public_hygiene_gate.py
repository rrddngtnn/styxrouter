"""Public hygiene gate fixture and failure-mode tests."""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
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
        """A clean fixture with skipped surfaces is incomplete, not clearance."""
        proc = run_gate(FIX / "clean")
        self.assertNotEqual(proc.returncode, 0, f"stderr: {proc.stderr}")
        self.assertEqual(proc.report_data["overall"], "incomplete")
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
            self.assertEqual(run_gate(root).report_data["gates"]["tracked_files"]["status"], "pass")


class HygieneRuntimeFailures(unittest.TestCase):
    def test_auth_denial_cannot_clear_runtime(self):
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(401)
                self.end_headers()
                self.wfile.write(b"clean")
            def log_message(self, format, *args):
                pass
        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            proc = run_gate(FIX / "clean", ["--runtime-url", f"http://127.0.0.1:{server.server_port}"])
            self.assertEqual(proc.report_data["gates"]["runtime"]["status"], "fail")
        finally:
            server.shutdown()
            server.server_close()
            thread.join()

    def test_unreachable_runtime_fails_without_exposing_url(self):
        proc = run_gate(FIX / "clean", ["--runtime-url", "http://127.0.0.1:1"])
        self.assertEqual(proc.report_data["gates"]["runtime"]["status"], "fail")
        self.assertNotEqual(proc.returncode, 0)

    def test_http_error_responses_are_scanned_and_server_errors_fail(self):
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(500 if self.path == "/api/health" else 401)
                self.end_headers()
                self.wfile.write(b"wave 9" if self.path == "/api/health" else b"clean")

            def log_message(self, format, *args):
                pass

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            proc = run_gate(FIX / "clean", ["--runtime-url", f"http://127.0.0.1:{server.server_port}"])
        finally:
            server.shutdown()
            server.server_close()
            thread.join()
        gate = proc.report_data["gates"]["runtime"]
        self.assertEqual(gate["status"], "fail")
        self.assertIn("P-VOCAB-WAVE", [hit["pattern"] for hit in gate["hits"]])

    def test_filename_hits_do_not_disclose_matched_string(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "acmeuser.txt").write_text("clean")
            proc = run_gate(root)
            self.assertNotIn("acmeuser", proc.stdout + json.dumps(proc.report_data))


class HygieneGitCoverage(unittest.TestCase):
    @staticmethod
    def git(root, *args, env=None):
        return subprocess.run(["git", "-C", str(root), *args], check=True, capture_output=True, env=env)

    def test_shallow_history_cannot_clear(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "source"
            root.mkdir()
            self.git(root, "init", "-q")
            env = dict(os.environ, GIT_AUTHOR_NAME="Clean", GIT_AUTHOR_EMAIL="a@example.test",
                       GIT_COMMITTER_NAME="Clean", GIT_COMMITTER_EMAIL="b@example.test")
            self.git(root, "commit", "--allow-empty", "-qm", "first", env=env)
            self.git(root, "commit", "--allow-empty", "-qm", "second", env=env)
            clone = Path(tmp) / "clone"
            subprocess.run(["git", "clone", "-q", "--depth=1", root.as_uri(), str(clone)], check=True)
            proc = run_gate(clone)
            self.assertNotEqual(proc.report_data["gates"]["historical_files"]["status"], "pass")

    def test_staged_content_is_scanned_even_when_worktree_is_clean(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.git(root, "init", "-q")
            (root / "candidate.txt").write_text("wave 9")
            self.git(root, "add", "candidate.txt")
            (root / "candidate.txt").write_text("clean")
            proc = run_gate(root)
            self.assertEqual(proc.report_data["gates"]["tracked_files"]["status"], "fail")

    def test_untracked_candidate_content_and_path(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            subprocess.run(["git", "init", "-q", str(root)], check=True)
            (root / "clean.txt").write_text("clean")
            subprocess.run(["git", "-C", str(root), "add", "clean.txt"], check=True)
            (root / "untracked-acmeuser.txt").write_text("wave 9")
            proc = run_gate(root)
            for gate in ("tracked_files", "filenames"):
                self.assertEqual(proc.report_data["gates"][gate]["status"], "fail")

    def test_commit_author_and_committer_are_scanned(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.git(root, "init", "-q")
            env = dict(os.environ, GIT_AUTHOR_NAME="acmeuser", GIT_AUTHOR_EMAIL="author@example.test",
                       GIT_COMMITTER_NAME="Clean", GIT_COMMITTER_EMAIL="committer@example.test")
            self.git(root, "commit", "--allow-empty", "-qm", "clean", env=env)
            proc = run_gate(root)
            self.assertEqual(proc.report_data["gates"]["commit_history"]["status"], "fail")
            self.assertNotIn("acmeuser", proc.stdout + json.dumps(proc.report_data))

    def test_deleted_historical_blob_and_path_are_scanned(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.git(root, "init", "-q")
            env = dict(os.environ, GIT_AUTHOR_NAME="Clean", GIT_AUTHOR_EMAIL="a@example.test",
                       GIT_COMMITTER_NAME="Clean", GIT_COMMITTER_EMAIL="b@example.test")
            (root / "acmeuser.txt").write_text("wave 9")
            self.git(root, "add", ".")
            self.git(root, "commit", "-qm", "first", env=env)
            self.git(root, "rm", "-q", "acmeuser.txt")
            self.git(root, "commit", "-qm", "second", env=env)
            proc = run_gate(root)
            self.assertEqual(proc.report_data["gates"]["historical_files"]["status"], "fail")
            self.assertNotIn("acmeuser", proc.stdout + json.dumps(proc.report_data))


class HygieneLimits(unittest.TestCase):
    def test_svg_text_is_scanned(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "image.svg").write_text("<svg><!-- wave 9 --></svg>")
            proc = run_gate(root)
            self.assertEqual(proc.report_data["gates"]["tracked_files"]["status"], "fail")

    def test_missing_repo_root_fails(self):
        proc = run_gate(Path(tempfile.gettempdir()) / "hygiene-nonexistent-repo-98765231")
        self.assertNotEqual(proc.returncode, 0)
        self.assertTrue(proc.report_data is None or proc.report_data["overall"] == "fail")

    @unittest.skipUnless((REPO_ROOT / "scripts" / "hygiene_private.py").is_file()
                         and not os.environ.get("HYGIENE_SKIP_PRIVATE"), "private catalog unavailable")
    def test_all_gates_complete_produces_clearance(self):
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b"clean")

            def log_message(self, format, *args):
                pass

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                HygieneGitCoverage.git(root, "init", "-q")
                env = dict(os.environ, GIT_AUTHOR_NAME="Clean", GIT_AUTHOR_EMAIL="a@example.test",
                           GIT_COMMITTER_NAME="Clean", GIT_COMMITTER_EMAIL="b@example.test")
                HygieneGitCoverage.git(root, "commit", "--allow-empty", "-qm", "clean", env=env)
                panel = root / "panel-dist"
                panel.mkdir()
                (panel / "index.html").write_text("clean")
                proc = run_gate(root, ["--panel-dist-dir", str(panel), "--runtime-url",
                                       f"http://127.0.0.1:{server.server_port}"])
                self.assertEqual(proc.report_data["overall"], "pass")
                self.assertEqual(proc.returncode, 0)
        finally:
            server.shutdown()
            server.server_close()
            thread.join()

    def test_missing_private_catalog_is_marked_incomplete(self):
        env = dict(os.environ, HYGIENE_SKIP_PRIVATE="1")
        with tempfile.TemporaryDirectory() as evidence:
            subprocess.run([sys.executable, str(SCRIPT), "--repo-root", str(FIX / "clean"),
                            "--evidence-dir", evidence], env=env, capture_output=True, text=True)
            report = json.loads(next(Path(evidence).glob("*/public-hygiene-report.json")).read_text())
        self.assertEqual(report["gates"]["operator_patterns"]["status"], "skipped")

    def test_oversized_historical_blob_fails_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            HygieneGitCoverage.git(root, "init", "-q")
            env = dict(os.environ, GIT_AUTHOR_NAME="Clean", GIT_AUTHOR_EMAIL="a@example.test",
                       GIT_COMMITTER_NAME="Clean", GIT_COMMITTER_EMAIL="b@example.test")
            (root / "large.txt").write_bytes(b"a" * (8 * 1024 * 1024 + 1))
            HygieneGitCoverage.git(root, "add", ".")
            HygieneGitCoverage.git(root, "commit", "-qm", "initial", env=env)
            proc = run_gate(root)
            self.assertEqual(proc.report_data["gates"]["historical_files"]["status"], "fail")

    def test_binary_extension_cannot_hide_identical_text_blob(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            HygieneGitCoverage.git(root, "init", "-q")
            env = dict(os.environ, GIT_AUTHOR_NAME="Clean", GIT_AUTHOR_EMAIL="a@example.test",
                       GIT_COMMITTER_NAME="Clean", GIT_COMMITTER_EMAIL="b@example.test")
            (root / "a.png").write_text("wave 9")
            (root / "b.txt").write_text("wave 9")
            HygieneGitCoverage.git(root, "add", ".")
            HygieneGitCoverage.git(root, "commit", "-qm", "initial", env=env)
            proc = run_gate(root)
            self.assertEqual(proc.report_data["gates"]["historical_files"]["status"], "fail")


if __name__ == "__main__":
    unittest.main()
