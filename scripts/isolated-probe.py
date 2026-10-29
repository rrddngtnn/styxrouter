#!/usr/bin/env python3
"""Run a trusted server probe with disposable state; this is not an OS sandbox."""
import os
import pwd
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

SERVER = Path(__file__).resolve().parent.parent / 'apps' / 'server'


def target_path(value):
    # The target walk below starts at SERVER, so validate its components too.
    if SERVER.parent.is_symlink() or SERVER.is_symlink():
        raise ValueError('server directory components must not be symlinks')
    path = Path(value)
    if '..' in path.parts:
        raise ValueError('path traversal is not allowed')
    path = path if path.is_absolute() else SERVER / path
    try:
        relative = path.relative_to(SERVER)
    except ValueError:
        raise ValueError('target must be inside apps/server') from None
    current = SERVER
    for part in relative.parts:
        current = current / part
        if current.is_symlink():
            raise ValueError('symlink target or path component is not allowed')
    if not current.is_file() or not current.resolve().is_relative_to(SERVER.resolve()):
        raise ValueError('target must be an existing regular file inside apps/server')
    return current


def main():
    if len(sys.argv) < 3 or sys.argv[1] not in ('test', 'script'):
        raise ValueError('usage: isolated-probe.py {test|script} <server-relative-file> [script args...]')
    mode, target, *args = sys.argv[1:]
    if mode == 'test' and args:
        raise ValueError('test mode does not accept extra arguments')
    target = target_path(target)
    bun = shutil.which('bun') or str(Path(pwd.getpwuid(os.getuid()).pw_dir) / '.bun/bin/bun')
    if not Path(bun).is_file():
        raise ValueError('Bun executable not found')
    with tempfile.TemporaryDirectory(prefix='isolated-probe-') as name:
        root = Path(name).resolve()
        home, tmp, data = (root / x for x in ('home', 'tmp', 'data'))
        for directory in (home, tmp, data):
            directory.mkdir(mode=0o700)
        env = {
            'PATH': str(Path(bun).resolve().parent) + os.pathsep + '/usr/bin:/bin',
            'HOME': str(home), 'USERPROFILE': str(home),
            'TMPDIR': str(tmp), 'TMP': str(tmp), 'TEMP': str(tmp),
            'XDG_CONFIG_HOME': str(home / '.config'), 'XDG_DATA_HOME': str(home / '.local/share'),
            'XDG_CACHE_HOME': str(home / '.cache'), 'DATA_DIR': str(data),
            'STYX_DATA_DIR': str(data), 'VIBEPROXY_DATA_DIR': str(data),
            'CURSOR_DATA_DIR': str(data / 'cursor'), 'QODER_CLI_CONFIG_DIR': str(data / 'qoder'),
            'APP_LOG_FILE_PATH': str(data / 'app.log'), 'STYX_ISOLATED_TEST': '1', 'NODE_ENV': 'test',
        }
        command = [bun, 'test', '--no-env-file', str(target)] if mode == 'test' else [bun, '--no-env-file', str(target), *args]
        return subprocess.run(command, cwd=tmp, env=env, check=False).returncode


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (ValueError, OSError) as error:
        sys.exit(f'isolated-probe: {error}')
