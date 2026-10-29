import os
import pathlib
import shutil
import subprocess
import tempfile
import unittest

REPO = pathlib.Path(__file__).resolve().parents[1]
SERVER = REPO / 'apps/server'
RUNNER = REPO / 'scripts/isolated-probe.py'
BUN = shutil.which('bun') or str(pathlib.Path.home() / '.bun/bin/bun')


class ProbeRunnerTest(unittest.TestCase):
    def test_environment_is_clean_before_module_import_and_dotenv_disabled(self):
        with tempfile.TemporaryDirectory(dir=SERVER, prefix='probe-fixture-') as name:
            root = pathlib.Path(name)
            fixture = root / 'probe.ts'
            fixture.write_text("""import { readFileSync, existsSync } from 'node:fs';
const env = process.env;
if (env.REDIS_URL || env.PROD_SECRET || env.PROBE_DOTENV) throw Error('inherited or dotenv secret');
for (const k of ['HOME','DATA_DIR','TMPDIR']) if (!env[k] || !existsSync(env[k])) throw Error(k);
if (env.HOME === env.DATA_DIR || env.DATA_DIR === env.TMPDIR) throw Error('not separate');
console.log(JSON.stringify({home: env.HOME, data: env.DATA_DIR, tmp: env.TMPDIR}));
""")
            scratch = pathlib.Path(os.environ['TMPDIR'])
            env = dict(os.environ, REDIS_URL='redis://production', PROD_SECRET='secret', HOME=str(root), DATA_DIR=str(root), TMPDIR=str(scratch))
            result = subprocess.run(['python3', str(RUNNER), 'script', str(fixture)], env=env, text=True, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            import json
            paths = json.loads(result.stdout.strip())
            for path in paths.values():
                self.assertTrue(pathlib.Path(path).is_relative_to(scratch), path)
                self.assertFalse(pathlib.Path(path).exists(), path)

    def test_dotenv_disabled_in_disposable_repo_and_test_mode(self):
        with tempfile.TemporaryDirectory() as name:
            repo = pathlib.Path(name)
            (repo / 'scripts').mkdir()
            server = repo / 'apps/server'
            server.mkdir(parents=True)
            shutil.copyfile(RUNNER, repo / 'scripts/isolated-probe.py')
            (server / '.env').write_text('PROBE_DOTENV=loaded\n')
            (server / 'probe.test.ts').write_text("""import {test, expect} from 'bun:test';
import { spawnSync } from 'node:child_process';
const observed = process.env.PROBE_DOTENV;
test('dotenv', () => {
  expect(observed).toBeUndefined();
  const child = spawnSync(process.execPath, ['-e', 'console.log(process.env.PROBE_DOTENV ?? "absent")'], {encoding: 'utf8'});
  expect(child.status).toBe(0);
  expect(child.stdout.trim()).toBe('absent');
  expect(process.cwd()).toBe(process.env.TMPDIR);
});""")
            env = dict(os.environ, PATH=str(pathlib.Path(BUN).parent) + os.pathsep + '/usr/bin:/bin')
            result = subprocess.run(['python3', str(repo / 'scripts/isolated-probe.py'), 'test', 'probe.test.ts'], env=env, text=True, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr)

    def test_child_bun_does_not_automatically_load_project_dotenv(self):
        with tempfile.TemporaryDirectory() as name:
            repo = pathlib.Path(name)
            (repo / 'scripts').mkdir()
            server = repo / 'apps/server'
            server.mkdir(parents=True)
            shutil.copyfile(RUNNER, repo / 'scripts/isolated-probe.py')
            (server / '.env').write_text('PROBE_CHILD_DOTENV=loaded\n')
            (server / 'probe.ts').write_text("""import { spawnSync } from 'node:child_process';
const result = spawnSync(process.execPath, ['-e', 'console.log(process.env.PROBE_CHILD_DOTENV ?? "absent")'], {encoding: 'utf8'});
if (result.status !== 0 || result.stdout.trim() !== 'absent') throw Error('child dotenv: ' + result.stdout + result.stderr);
if (process.cwd() !== process.env.TMPDIR) throw Error('cwd is not disposable tmp');
""")
            env = dict(os.environ, PATH=str(pathlib.Path(BUN).parent) + os.pathsep + '/usr/bin:/bin')
            result = subprocess.run(['python3', str(repo / 'scripts/isolated-probe.py'), 'script', 'probe.ts'], env=env, text=True, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr)

    def test_explicit_child_server_cwd_requires_no_env_file(self):
        with tempfile.TemporaryDirectory() as name:
            repo = pathlib.Path(name)
            (repo / 'scripts').mkdir()
            server = repo / 'apps/server'
            server.mkdir(parents=True)
            shutil.copyfile(RUNNER, repo / 'scripts/isolated-probe.py')
            (server / '.env').write_text('PROBE_CHILD_DOTENV=loaded\n')
            (server / 'probe.ts').write_text("""import { spawnSync } from 'node:child_process';
for (const [flags, expected] of [[[], 'loaded'], [['--no-env-file'], 'absent']]) {
  const child = spawnSync(process.execPath, [...flags, '-e', 'console.log(process.env.PROBE_CHILD_DOTENV ?? "absent")'], {cwd: import.meta.dir, encoding: 'utf8'});
  if (child.status !== 0 || child.stdout.trim() !== expected) throw Error('child dotenv: ' + child.stdout + child.stderr);
}
""")
            env = dict(os.environ, PATH=str(pathlib.Path(BUN).parent) + os.pathsep + '/usr/bin:/bin')
            result = subprocess.run(['python3', str(repo / 'scripts/isolated-probe.py'), 'script', 'probe.ts'], env=env, text=True, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr)

    def test_rejects_escape_and_symlink(self):
        with tempfile.TemporaryDirectory(dir=SERVER, prefix='probe-fixture-') as name:
            root = pathlib.Path(name)
            link = root / 'link.ts'
            link.symlink_to('/etc/passwd')
            for target in [str(link), '../package.json', str(root / '..' / '..' / 'package.json')]:
                result = subprocess.run(['python3', str(RUNNER), 'script', target], text=True, capture_output=True)
                self.assertNotEqual(result.returncode, 0, target)

if __name__ == '__main__':
    unittest.main()
