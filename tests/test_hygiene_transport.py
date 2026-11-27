"""Protected workflow transport contracts; synthetic inputs only."""
import base64
import gzip
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
HELPER = ROOT / 'scripts/materialize-hygiene-inputs.py'
ENTRY = dict(pattern='fixture', file='README.md', surface='tracked_file',
             sha256='a' * 64, lines=[1, 1], reason='Reviewed attribution — preserved.')
RAW = (json.dumps([ENTRY], ensure_ascii=False, indent=2) + '\n').encode()
CATALOG = b"from hygiene_patterns import _p\nPRIVATE_PATTERNS = [_p('fixture', r'fixture', 'fatal', 'fixture')]\n"


def b64(raw):
    return base64.b64encode(raw).decode('ascii')


class HygieneTransport(unittest.TestCase):
    def invoke(self, legacy=b64(RAW), compressed='', catalog=CATALOG):
        with tempfile.TemporaryDirectory() as tmp:
            env = dict(os.environ, RUNNER_TEMP=tmp, PRIVATE_CATALOG_B64=b64(catalog),
                       PRIVATE_ALLOWLIST_B64=legacy, PRIVATE_ALLOWLIST_GZIP_B64=compressed)
            env.pop('HYGIENE_SKIP_PRIVATE', None)
            proc = subprocess.run([sys.executable, str(HELPER)], env=env,
                                  capture_output=True)
            target = Path(tmp) / 'hygiene_private_allowlist.json'
            data = target.read_bytes() if target.exists() else None
            mode = target.stat().st_mode & 0o777 if target.exists() else None
            return proc, data, mode

    def test_gzip_preserves_exact_original_bytes(self):
        proc, data, mode = self.invoke(compressed=b64(gzip.compress(RAW, mtime=0)))
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(data, RAW)
        self.assertEqual(mode, 0o600)
        self.assertEqual(proc.stdout, b'')
        self.assertEqual(proc.stderr, b'')


    def test_legacy_base64_remains_byte_exact(self):
        proc, data, mode = self.invoke()
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(data, RAW)
        self.assertEqual(mode, 0o600)

    def test_new_secret_does_not_require_valid_legacy_value(self):
        proc, data, _ = self.invoke(legacy='obsolete', compressed=b64(gzip.compress(RAW)))
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(data, RAW)

    def test_invalid_transport_fails_closed_without_secret_output(self):
        zipped = gzip.compress(RAW)
        cases = ['not base64!', b64(zipped[:-1]), b64(zipped + b'trailing'),
                 b64(zipped + zipped), b64(gzip.compress(b'x' * (1024 * 1024 + 1))),
                 b64(gzip.compress(b'\xff')), b64(gzip.compress(b'private-invalid-json')),
                 b64(RAW)]
        for value in cases:
            with self.subTest(case=cases.index(value)):
                proc, data, _ = self.invoke(compressed=value)
                self.assertNotEqual(proc.returncode, 0)
                self.assertIsNone(data)
                self.assertEqual(proc.stdout, b'')
                self.assertEqual(proc.stderr, b'Protected hygiene inputs are missing or invalid.\n')

    def test_legacy_invalid_inputs_fail_closed(self):
        for raw in [None, b'\xff', b'private-invalid-json', b'{}']:
            with self.subTest(kind=type(raw).__name__):
                proc, data, _ = self.invoke(legacy='!' if raw is None else b64(raw))
                self.assertNotEqual(proc.returncode, 0)
                self.assertIsNone(data)

    def test_uncompressed_limit_is_enforced_without_os_environment_limit(self):
        import importlib.util
        spec = importlib.util.spec_from_file_location('materializer', HELPER)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with self.assertRaises(ValueError):
            module.decode(b64(b'x' * (module.MAX_INPUT_BYTES + 1)))
        with self.assertRaises(ValueError):
            module.decode(b64(gzip.compress(b'x' * (module.MAX_INPUT_BYTES + 1))), compressed=True)

    def test_workflow_uses_helper_and_additive_secret_only_in_protected_step(self):
        workflow = (ROOT / '.github/workflows/publication-hygiene.yml').read_text()
        self.assertIn('environment: publication-hygiene', workflow)
        self.assertIn('  contents: read', workflow)
        self.assertNotIn('pull_request:', workflow)
        self.assertIn('PRIVATE_ALLOWLIST_B64: ${{ secrets.HYGIENE_PRIVATE_ALLOWLIST_B64 }}', workflow)
        self.assertIn('PRIVATE_ALLOWLIST_GZIP_B64: ${{ secrets.HYGIENE_PRIVATE_ALLOWLIST_GZIP_B64 }}', workflow)
        self.assertIn('run: python3 scripts/materialize-hygiene-inputs.py', workflow)
        self.assertNotIn('base64 --decode', workflow)

    def test_binding_validation_is_not_weakened(self):
        for changes in [dict(pattern='unknown'), dict(file='../escape'), dict(sha256='bad'),
                        dict(reason=''), dict(lines=[2, 1]), dict(extra=True),
                        dict(surface='historical_file'), dict(surface='panel_bundle')]:
            with self.subTest(field=next(iter(changes))):
                invalid = json.dumps([{**ENTRY, **changes}]).encode()
                for compressed in [False, True]:
                    proc, data, _ = self.invoke(
                        legacy=b64(invalid),
                        compressed=b64(gzip.compress(invalid)) if compressed else '')
                    self.assertNotEqual(proc.returncode, 0)
                    self.assertIsNone(data)


if __name__ == '__main__':
    unittest.main()
