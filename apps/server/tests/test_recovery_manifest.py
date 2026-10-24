import importlib.util
import os
from pathlib import Path
import stat
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "recovery-manifest.py"
spec = importlib.util.spec_from_file_location("recovery_manifest", SCRIPT)
assert spec is not None and spec.loader is not None
rm = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rm)


SECRET_VALUE = "DO_NOT_LEAK_THIS_VALUE_f9b1c2a0"


class RecoveryManifestTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=os.environ["TMPDIR"])
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.unit_dir = self.root / "etc"
        self.unit_dir.mkdir()
        self.drop_in = self.unit_dir / "styx.service.d"
        self.drop_in.mkdir()
        self.data_root = self.root / "data"
        self.data_root.mkdir(mode=0o700)
        self.env_file = self.data_root / ".env"
        self.env_file.write_text(
            "STORAGE_ENCRYPTION_KEY=" + SECRET_VALUE + "\n"
            "OTHER_SECRET=another_secret_x7y8z9\n"
            "# comment line\n"
            "\n"
        )
        self.env_file.chmod(0o600)
        self.binary = self.root / "bin" / "styx"
        self.binary.parent.mkdir()
        self.binary.write_text("#!/bin/sh\nexit 0\n")
        self.binary.chmod(0o755)
        self.unit = self.unit_dir / "styx.service"
        self.unit.write_text(
            "[Service]\n"
            "User=youruser\n"
            "Environment=DATA_DIR=" + str(self.data_root) + "\n"
            "Environment=STORAGE_ENCRYPTION_KEY_SOURCE=" + str(self.env_file) + "\n"
            "ExecStart=" + str(self.binary) + " serve\n"
        )
        (self.drop_in / "10-override.conf").write_text(
            "[Service]\nEnvironment=NODE_OPTIONS=--max-old-space-size=1024\n"
        )

    def test_manifest_lists_every_recovery_prerequisite(self):
        manifest = rm.render(rm.collect(unit_file=self.unit, drop_in_dir=self.drop_in,
                                        data_root=self.data_root, env_files=[self.env_file]))
        for header in ["# Boot/decryption recovery manifest", "## Unit file", "## Drop-ins",
                       "## ExecStart binary", "## Data root", "## Environment keys",
                       "## Env files (metadata only)"]:
            self.assertIn(header, manifest)
        self.assertIn("STORAGE_ENCRYPTION_KEY", manifest)
        self.assertIn("DATA_DIR", manifest)
        self.assertIn("NODE_OPTIONS", manifest)
        self.assertIn(str(self.binary), manifest)
        self.assertIn("mode=0o600", manifest)

    def test_manifest_never_leaks_env_file_values(self):
        manifest = rm.render(rm.collect(unit_file=self.unit, drop_in_dir=self.drop_in,
                                        data_root=self.data_root, env_files=[self.env_file]))
        self.assertNotIn(SECRET_VALUE, manifest)
        self.assertNotIn("another_secret_x7y8z9", manifest)

    def test_missing_prerequisite_raises(self):
        self.unit.unlink()
        with self.assertRaises(FileNotFoundError):
            rm.collect(unit_file=self.unit, drop_in_dir=self.drop_in,
                       data_root=self.data_root, env_files=[self.env_file])

    def test_unreadable_env_file_is_reported_without_crashing(self):
        self.env_file.chmod(0o000)
        try:
            manifest = rm.render(rm.collect(unit_file=self.unit, drop_in_dir=self.drop_in,
                                            data_root=self.data_root, env_files=[self.env_file]))
        finally:
            self.env_file.chmod(0o600)
        self.assertIn("unreadable", manifest.lower())
        self.assertNotIn(SECRET_VALUE, manifest)

    def test_data_root_mode_and_owner_are_captured(self):
        collected = rm.collect(unit_file=self.unit, drop_in_dir=self.drop_in,
                               data_root=self.data_root, env_files=[self.env_file])
        self.assertEqual(collected["data_root"]["mode"], 0o700)
        self.assertEqual(collected["data_root"]["uid"], os.getuid())


if __name__ == "__main__":
    unittest.main()
