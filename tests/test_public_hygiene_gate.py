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


class HygieneBoundExceptions(unittest.TestCase):
    @staticmethod
    def module():
        import importlib.util
        spec = importlib.util.spec_from_file_location("hygiene_gate_test", SCRIPT)
        mod = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = mod
        spec.loader.exec_module(mod)
        return mod

    def test_bound_context_digest_range_and_schema_fail_closed(self):
        import hashlib
        mod = self.module()
        text = "ExampleAgent\nExampleAgent\n"
        entry = dict(pattern="P-TEST", file="guide.md", surface="tracked_file",
                     sha256=hashlib.sha256(text.encode()).hexdigest(), lines=[1, 1], reason="Public client")
        from types import SimpleNamespace
        compiled = mod.compile_patterns([SimpleNamespace(name="P-TEST", regex="ExampleAgent", severity="fatal",
            surfaces={"tracked_file", "panel_bundle", "runtime"})])
        self.assertEqual(len(mod._scan_text(text, "guide.md", "tracked_file", compiled, [entry])), 1)
        for content, path, surface in [(text + "edit", "guide.md", "tracked_file"),
                (text, "other.md", "tracked_file"), (text, "guide.md", "panel_bundle"),
                (text, "guide.md", "runtime")]:
            self.assertEqual(len(mod._scan_text(content, path, surface, compiled, [entry])), 2)
        with tempfile.TemporaryDirectory() as tmp:
            f = Path(tmp) / "review.json"
            for change in [{"lines": [0, 1]}, {"lines": [1, True]}, {"reason": ""}, {"sha256": "bad"},
                    {"file": "../guide.md"}, {"file": "*.md"}, {"surface": "runtime"}, {"pattern": "unknown"},
                    {"section": "Credits"}]:
                f.write_text(json.dumps([dict(entry, **change)]))
                with self.assertRaises(ValueError):
                    mod.load_bound_allowlist(f, {"P-TEST"})

    def test_historical_exceptions_require_full_object_and_do_not_cover_other_paths(self):
        import hashlib
        mod = self.module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            HygieneGitCoverage.git(root, "init", "-q")
            env = dict(os.environ, GIT_AUTHOR_NAME="Clean", GIT_AUTHOR_EMAIL="a@example.test",
                       GIT_COMMITTER_NAME="Clean", GIT_COMMITTER_EMAIL="b@example.test")
            (root / "credit.md").write_text("OmniRoute attribution\n")
            HygieneGitCoverage.git(root, "add", ".")
            HygieneGitCoverage.git(root, "commit", "-qm", "first", env=env)
            oid = HygieneGitCoverage.git(root, "rev-parse", "HEAD:credit.md").stdout.decode().strip()
            entry = dict(pattern="P-STRUCT-OMNI", file="credit.md", surface="historical_file", blob=oid,
                sha256=hashlib.sha256((root / "credit.md").read_bytes()).hexdigest(), lines=[1, 1], reason="Legal notice")
            overlay = root / "review.json"
            overlay.write_text(json.dumps([entry]))
            allowed = mod.load_bound_allowlist(overlay, {"P-STRUCT-OMNI"})
            compiled = mod.compile_patterns(mod.load_patterns().PATTERNS)
            self.assertEqual(mod.gate_historical_files(root, compiled, [], allowed).status, "pass")
            (root / "other.md").write_text((root / "credit.md").read_text())
            HygieneGitCoverage.git(root, "add", "other.md")
            HygieneGitCoverage.git(root, "commit", "-qm", "second", env=env)
            self.assertEqual(mod.gate_historical_files(root, compiled, [], allowed).status, "fail")

    def test_bundle_exception_binds_exact_character_span_not_entire_minified_line(self):
        import hashlib
        mod = self.module()
        from types import SimpleNamespace
        text = '"ExampleAgent";"ExampleAgent"'
        compiled = mod.compile_patterns([SimpleNamespace(name="P-TEST", regex="ExampleAgent", severity="fatal", surfaces={"panel_bundle"})])
        entry = dict(pattern="P-TEST", file="assets/app.js", surface="panel_bundle",
            sha256=hashlib.sha256(text.encode()).hexdigest(), lines=[1, 1], offsets=[1, 13], reason="Verified bundled integration display name")
        with tempfile.TemporaryDirectory() as tmp:
            f = Path(tmp) / "review.json"
            f.write_text(json.dumps([entry]))
            allowed = mod.load_bound_allowlist(f, {"P-TEST"})
            self.assertEqual(len(mod._scan_text(text, "assets/app.js", "panel_bundle", compiled, allowed)), 1)
            entry.pop("offsets")
            f.write_text(json.dumps([entry]))
            with self.assertRaises(ValueError):
                mod.load_bound_allowlist(f, {"P-TEST"})

    def test_explicit_missing_private_inputs_and_unknown_patterns_fail_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            missing = str(Path(tmp) / "missing.json")
            for args in [["--private-patterns", missing], ["--private-allowlist", missing]]:
                proc = run_gate(FIX / "clean", args)
                self.assertNotEqual(proc.returncode, 0)
                self.assertIsNone(proc.report_data)
            overlay = Path(tmp) / "overlay.json"
            overlay.write_text('[{"pattern":"P-PRIVATE-UNAVAILABLE","file":"guide.md"}]')
            proc = run_gate(FIX / "clean", ["--allowlist", str(overlay)])
            self.assertNotEqual(proc.returncode, 0)
            self.assertIsNone(proc.report_data)

    def test_explicit_private_catalog_and_bound_overlay(self):
        import hashlib
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "candidate"
            root.mkdir()
            text = "Public ExampleAgent integration\nprivate ExampleAgent note\n"
            (root / "guide.md").write_text(text)
            catalog = Path(tmp) / "catalog.py"
            catalog.write_text('from hygiene_patterns import _p\nPRIVATE_PATTERNS = [_p("P-TEST-AGENT", r"ExampleAgent")]\n')
            overlay = Path(tmp) / "review.json"
            overlay.write_text(json.dumps([dict(pattern="P-TEST-AGENT", file="guide.md",
                surface="tracked_file", sha256=hashlib.sha256(text.encode()).hexdigest(),
                lines=[1, 1], reason="Verified public integration selector")]))
            from unittest.mock import patch
            env = dict(os.environ)
            env.pop("HYGIENE_SKIP_PRIVATE", None)
            with patch.dict(os.environ, env, clear=True):
                proc = run_gate(root, ["--private-patterns", str(catalog), "--private-allowlist", str(overlay)])
            self.assertIsNotNone(proc.report_data, proc.stderr)
            self.assertTrue(proc.report_data["operator_private_patterns_loaded"])
            hits = proc.report_data["gates"]["tracked_files"]["hits"]
            self.assertEqual([h["line"] for h in hits], [2])


if __name__ == "__main__":
    unittest.main()
