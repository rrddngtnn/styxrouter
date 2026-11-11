"""Unit coverage of Docker smoke orchestration; not a real image smoke."""
import importlib.util
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("docker_smoke", Path(__file__).parents[1] / "scripts/docker-smoke.py")
assert SPEC is not None and SPEC.loader is not None
smoke = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(smoke)


class DockerSmokeTests(unittest.TestCase):
    def test_notice_inventory_covers_retained_sources(self):
        script = smoke.probe_script()
        for path in (smoke.ROOT / "apps/server/licenses").iterdir():
            if path.is_file():
                self.assertIn('/app/apps/server/licenses/' + path.name, script)
        self.assertIn('/app/CREDITS.md', script)
        self.assertIn('provider-icon-NOTICE.md', script)
        self.assertIn('session model catalog', script)
        self.assertIn('dashboard session may read model catalog without API key', script)
        self.assertIn('dashboard session must not authorize inference', script)
        self.assertIn('INITIAL_PASSWORD', script)

    def test_approved_brand_inventory_is_checked_inside_actual_image(self):
        script = smoke.probe_script()
        import hashlib
        for path in (smoke.ROOT / 'apps/panel/public/brand').iterdir():
            if path.is_file():
                self.assertIn('/app/apps/server/panel/brand/' + path.name, script)
                self.assertIn(hashlib.sha256(path.read_bytes()).hexdigest(), script)
        self.assertIn('/app/apps/server/panel/favicon.ico', script)

    def test_image_labels_are_verified_before_start(self):
        calls, runner = self.lifecycle(invalid_labels=True)
        with patch.object(smoke.shutil, 'which', return_value='/unit/docker'), patch.object(smoke, 'run', side_effect=runner), patch.object(smoke.subprocess, 'run'):
            with self.assertRaisesRegex(RuntimeError, 'image labels'):
                smoke.main('test:unit')
        self.assertFalse(any(args[:2] == ('docker', 'run') for args, _ in calls))

    @patch.object(smoke.shutil, "which", return_value=None)
    def test_missing_docker_fails_before_start(self, _which):
        with self.assertRaisesRegex(SystemExit, "no image smoke was executed"):
            smoke.main("test:unit")

    def lifecycle(self, health="running healthy", fail_exec=False, invalid_labels=False):
        calls = []
        def fake_run(*args, **kwargs):
            calls.append((args, kwargs))
            if args[:3] == ("docker", "image", "inspect"):
                return subprocess.CompletedProcess(args, 0, '{}' if invalid_labels else '{"org.opencontainers.image.title":"StyxRouter","org.opencontainers.image.version":"v0.1.5"}')
            if args[:2] == ("docker", "inspect"):
                return subprocess.CompletedProcess(args, 0, health)
            if fail_exec and args[:2] == ("docker", "exec"):
                raise subprocess.CalledProcessError(1, args)
            return subprocess.CompletedProcess(args, 0)
        return calls, fake_run

    @patch.object(smoke.shutil, "which", return_value="/unit/docker")
    def test_isolation_and_cleanup(self, _which):
        calls, runner = self.lifecycle()
        with patch.object(smoke, "run", side_effect=runner), patch.object(smoke.subprocess, "run") as cleanup:
            smoke.main("test:unit")
        args = next(args for args, _ in calls if args[:2] == ('docker', 'run'))
        self.assertIn("--read-only", args)
        self.assertIn("none", args)
        self.assertNotIn("--publish", args)
        self.assertNotIn("--volume", args)
        self.assertNotIn("--env-file", args)
        self.assertIn("/data:rw,nosuid,nodev,mode=1777", args)
        env = [args[i + 1] for i, arg in enumerate(args) if arg == "--env"]
        for key in ("JWT_SECRET", "API_KEY_SECRET", "STORAGE_ENCRYPTION_KEY", "INITIAL_PASSWORD"):
            self.assertRegex(next(v for v in env if v.startswith(key + "=")), key + r"=[a-f0-9]{64}$")
        self.assertEqual(calls[-1][0][:2], ("docker", "exec"))
        self.assertIn("--volumes", cleanup.call_args.args[0])

    @patch.object(smoke.shutil, "which", return_value="/unit/docker")
    def test_unhealthy_fails_closed_and_cleans(self, _which):
        calls, runner = self.lifecycle("running unhealthy")
        with patch.object(smoke, "run", side_effect=runner), patch.object(smoke.subprocess, "run") as cleanup:
            with self.assertRaisesRegex(RuntimeError, "failed health"):
                smoke.main("test:unit")
        self.assertFalse(any(args[:2] == ("docker", "exec") for args, _ in calls))
        cleanup.assert_called_once()

    @patch.object(smoke.shutil, "which", return_value="/unit/docker")
    def test_probe_failure_propagates_and_cleans(self, _which):
        _, runner = self.lifecycle(fail_exec=True)
        with patch.object(smoke, "run", side_effect=runner), patch.object(smoke.subprocess, "run") as cleanup:
            with self.assertRaises(subprocess.CalledProcessError):
                smoke.main("test:unit")
        cleanup.assert_called_once()


if __name__ == "__main__":
    unittest.main()
