# Isolated probes

Run a trusted server test or script with disposable state:

```sh
python3 scripts/isolated-probe.py test tests/example.test.ts
python3 scripts/isolated-probe.py script scripts/example.ts arg
python3 -m unittest discover -s tests -p test_isolated_probe_runner.py -v
```

Targets are files relative to `apps/server` (or absolute paths beneath it); traversal and symlink components are refused. Test mode accepts no extra options. The runner starts Bun with dotenv loading disabled and an allowlisted environment, including fresh HOME, DATA_DIR and TMPDIR before any probe imports. Its working directory is the disposable TMPDIR, not the server directory; resolve project-relative files using the module location rather than the working directory. This also prevents an ordinary child Bun process inheriting that working directory from automatically loading the server's `.env`. The `--no-env-file` flag applies to the initial Bun invocation, not automatically to subprocesses: a child Bun process explicitly started with its working directory set to the server directory can load that directory's `.env`. Pass `--no-env-file` to every Bun subprocess or keep its working directory disposable. `STYX_ISOLATED_TEST` is only a convention for cooperating code, not a sandbox or authorization boundary. Temporary state is created under the caller's temporary directory (`TMPDIR` when set) and cleaned after the process exits. Bun must be on PATH or installed in the current account's `~/.bun/bin`.

**This is an accident guard, not an OS sandbox.** Trusted probe code still has the user's filesystem and network permissions, can override its own environment, launch processes, load dotenv explicitly, or contact services. Review probes and their imports before running; never use this to execute untrusted code or target production. Path checks are not race-resistant against a concurrent adversary. A hard kill or crash may leave temporary directories behind. This runner does not change the existing `test-isolated.ts` runner; use this command explicitly for probes.
