import importlib.util
import json
import subprocess
import sys
from unittest import mock
import os
from pathlib import Path
import stat
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "snapshot-installed.py"
spec = importlib.util.spec_from_file_location("snapshot_installed", SCRIPT)
assert spec is not None and spec.loader is not None
backup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup)


class SnapshotTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=os.environ["TMPDIR"])
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / "source"
        self.source.mkdir()
        (self.source / "nested").mkdir(mode=0o750)
        (self.source / "empty").mkdir(mode=0o700)
        (self.source / "nested" / "sample.bin").write_bytes(b"\x00fixture\xff\n")
        (self.source / "nested" / "sample.bin").chmod(0o640)
        (self.source / "run.sh").write_bytes(b"#!/bin/sh\nexit 0\n")
        (self.source / "run.sh").chmod(0o750)
        self.source.chmod(0o750)
        self.snapshot = self.root / "snapshot"
        self.restored = self.root / "restored"

    def tree(self, root):
        return {
            str(p.relative_to(root)): (
                "dir" if p.is_dir() else "file",
                stat.S_IMODE(p.stat().st_mode),
                None if p.is_dir() else p.read_bytes(),
            )
            for p in [root, *root.rglob("*")]
        }

    def test_rejects_snapshot_inside_source_before_writing(self):
        destination = self.source / "nested-snapshot"
        with self.assertRaises(ValueError):
            backup.snapshot(self.source, destination)
        self.assertFalse(destination.exists())

    def test_restore_rejects_populated_destination_without_overwrite(self):
        backup.snapshot(self.source, self.snapshot)
        self.restored.mkdir()
        sentinel = self.restored / "run.sh"
        sentinel.write_bytes(b"DO NOT CHANGE")
        with self.assertRaises(ValueError):
            backup.restore(self.snapshot, self.restored)
        self.assertEqual(sentinel.read_bytes(), b"DO NOT CHANGE")
        self.assertEqual(list(self.restored.iterdir()), [sentinel])

    def test_invalid_manifest_paths_are_reported_before_restore(self):
        backup.snapshot(self.source, self.snapshot)
        manifest = self.snapshot / "manifest.json"
        original = json.loads(manifest.read_text())
        for malicious in [None, "../escaped", "/absolute", "nested/../../escaped", "nested/./file"]:
            with self.subTest(path=malicious):
                data = json.loads(json.dumps(original))
                data["entries"][1]["path"] = malicious
                manifest.write_text(json.dumps(data))
                self.assertTrue(backup.verify(self.snapshot))
                with self.assertRaises(ValueError):
                    backup.restore(self.snapshot, self.restored)
                self.assertFalse(self.restored.exists())

    def test_verify_reports_malformed_manifest_without_throwing(self):
        backup.snapshot(self.source, self.snapshot)
        (self.snapshot / "manifest.json").write_text('{"version": 1}')
        self.assertTrue(backup.verify(self.snapshot))
        with self.assertRaises(ValueError):
            backup.restore(self.snapshot, self.restored)
        self.assertFalse(self.restored.exists())

    def test_partial_snapshot_is_not_left_after_copy_failure(self):
        with mock.patch.object(backup.shutil, "copyfile", side_effect=OSError("fixture IO failure")):
            with self.assertRaises(OSError):
                backup.snapshot(self.source, self.snapshot)
        self.assertFalse(self.snapshot.exists())

    def test_manifest_cannot_grant_special_permission_bits(self):
        self.source.chmod(0o2750)
        with self.assertRaises(ValueError):
            backup.snapshot(self.source, self.snapshot)
        self.assertFalse(self.snapshot.exists())

    def test_corrupt_payload_blocks_restore_before_writes(self):
        backup.snapshot(self.source, self.snapshot)
        (self.snapshot / "payload/run.sh").write_bytes(b"corrupt")
        self.assertTrue(backup.verify(self.snapshot))
        with self.assertRaises(ValueError):
            backup.restore(self.snapshot, self.restored)
        self.assertFalse(self.restored.exists())

    def test_symlinks_in_source_payload_and_destination_are_rejected(self):
        link = self.source / "escape"
        link.symlink_to(self.root)
        with self.assertRaises(ValueError):
            backup.snapshot(self.source, self.snapshot)
        self.assertFalse(self.snapshot.exists())
        link.unlink()
        backup.snapshot(self.source, self.snapshot)
        redirected = self.root / "redirected"
        redirected.mkdir()
        self.restored.symlink_to(redirected, target_is_directory=True)
        with self.assertRaises(ValueError):
            backup.restore(self.snapshot, self.restored)
        self.assertEqual(list(redirected.iterdir()), [])
        self.restored.unlink()
        (self.snapshot / "payload/run.sh").unlink()
        (self.snapshot / "payload/run.sh").symlink_to(self.source / "run.sh")
        self.assertTrue(backup.verify(self.snapshot))
        with self.assertRaises(ValueError):
            backup.restore(self.snapshot, self.restored)
        self.assertFalse(self.restored.exists())

    def test_existing_snapshot_is_never_overwritten(self):
        backup.snapshot(self.source, self.snapshot)
        before = self.tree(self.snapshot)
        with self.assertRaises(ValueError):
            backup.snapshot(self.source, self.snapshot)
        self.assertEqual(self.tree(self.snapshot), before)

    def test_restore_accepts_empty_real_directory(self):
        backup.snapshot(self.source, self.snapshot)
        self.restored.mkdir()
        backup.restore(self.snapshot, self.restored)
        self.assertEqual(self.tree(self.source), self.tree(self.restored))

    def test_source_mutation_during_copy_prevents_snapshot_publication(self):
        original = backup.shutil.copyfile
        def mutate(source, destination):
            result = original(source, destination)
            (self.source / "run.sh").write_bytes(b"changed")
            return result
        with mock.patch.object(backup.shutil, "copyfile", side_effect=mutate):
            with self.assertRaises(ValueError):
                backup.snapshot(self.source, self.snapshot)
        self.assertFalse(self.snapshot.exists())

    def test_cli_roundtrip_and_corruption_exit_codes(self):
        def run(*args):
            return subprocess.run([sys.executable, str(SCRIPT), *map(str, args)],
                                  capture_output=True, text=True, check=False)
        for args in [("snapshot", self.source, self.snapshot), ("verify", self.snapshot),
                     ("restore", self.snapshot, self.restored)]:
            result = run(*args)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(result.stdout.strip(), "OK: " + args[0])
        (self.snapshot / "payload/run.sh").write_bytes(b"PRIVATE FIXTURE VALUE")
        result = run("verify", self.snapshot)
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("PRIVATE FIXTURE VALUE", result.stdout + result.stderr)

    def test_unreadable_source_subtree_fails_without_publishing_snapshot(self):
        locked = self.source / "nested"
        original = locked.stat().st_mode
        locked.chmod(0o000)
        try:
            with self.assertRaises((OSError, ValueError)):
                backup.snapshot(self.source, self.snapshot)
        finally:
            locked.chmod(original)
        self.assertFalse(self.snapshot.exists())

    def test_publication_failure_leaves_no_half_written_snapshot(self):
        with mock.patch.object(backup.os, "replace", side_effect=OSError("fixture publication failure")):
            with self.assertRaises(OSError):
                backup.snapshot(self.source, self.snapshot)
        self.assertFalse(self.snapshot.exists())

    def test_symlinked_snapshot_root_and_manifest_are_rejected(self):
        backup.snapshot(self.source, self.snapshot)
        aliased_root = self.root / "aliased-snapshot"
        aliased_root.symlink_to(self.snapshot, target_is_directory=True)
        with self.assertRaises(ValueError):
            backup.restore(aliased_root, self.restored)
        self.assertFalse(self.restored.exists())
        aliased_root.unlink()
        real_manifest = self.snapshot / "manifest.json"
        hidden = self.root / "external-manifest.json"
        hidden.write_bytes(real_manifest.read_bytes())
        real_manifest.unlink()
        real_manifest.symlink_to(hidden)
        self.assertTrue(backup.verify(self.snapshot))
        with self.assertRaises(ValueError):
            backup.restore(self.snapshot, self.restored)
        self.assertFalse(self.restored.exists())

    def test_snapshot_verify_restore_preserves_bytes_modes_and_empty_directories(self):
        manifest = backup.snapshot(self.source, self.snapshot)
        self.assertEqual(manifest, self.snapshot / "manifest.json")
        self.assertEqual(backup.verify(self.snapshot), [])
        backup.restore(self.snapshot, self.restored)
        self.assertEqual(self.tree(self.source), self.tree(self.restored))


if __name__ == "__main__":
    unittest.main()
