# Offline SQLite recovery: scratch rehearsal only

**Production restore remains unsupported and must fail closed.** This is a tested rehearsal on newly generated, independent SQLite files, not an authorization or procedure to replace `storage.sqlite`. See [the restore blocker](sqlite-restore-blocker.md) and [sql.js safety](sqljs-file-backend-safety.md). The test takes no database path: it creates and removes a private fixture directory beneath `TMPDIR`, and never opens a service database or backup. Set `TMPDIR` to a private scratch directory, not a service data directory.

## Rehearsal

From the repository root, run:

```sh
python3 -W error::ResourceWarning -m unittest discover -s tests -p 'test_sqlite_offline_recovery_constraints.py' -v
```

The fixture creates a WAL-mode database and commits a marker with auto-checkpoint disabled. It verifies that copying only the main file loses that committed marker; SQLite's backup API captures it, and a second SQLite backup into a fresh scratch database restores it with `PRAGMA integrity_check` returning `ok`. This demonstrates the mechanics of a logical snapshot and an independent recovery rehearsal, not a complete production recovery protocol. Integrity alone does not prove schema/application compatibility or preservation of every relevant service artifact.

The suite additionally checks a malformed candidate is rejected before creating a recovery destination, a busy checkpoint reports busy and preserves committed data, a separately spawned SQLite writer commits after a successful checkpoint, and a separate process can replace a database file despite an SQLite exclusive transaction. In the last experiment the old connection and new pathname see different database images. The external replacement models the relevant rename behavior of an already-running legacy sql.js saver; it is not a test of sql.js itself. No destructive sidecar cleanup or live restore is tested.

## Why this does not unlock production recovery

An SQLite lock or checkpoint protects SQLite participants under the supported locking model; neither prevents arbitrary filesystem rename or a process saving an old sql.js image. A completed checkpoint releases its lock. Process lists, service status, a tool-only advisory lock, and a confirmation prompt cannot establish that no noncooperating process or remote host has existing or future access. Thus the existing deployment boundary does **not** provide an enforceable exclusive protocol. There is no safe operator override and no supported offline restore command for that boundary.

A future implementation needs a verified, enforced exclusion boundary encompassing **all** accessors for the entire maintenance operation and restart handoff, including older sql.js processes, external clients, aliases, inherited descriptors, privileged processes, and other hosts. This may require separately administered host/storage isolation that prevents access rather than merely a cooperative lock; where such exclusion cannot be established, refuse. In addition it needs validated independent backups, a verified recovery point that includes WAL commits, crash-recoverable publication and rollback, sidecar handling, ownership/permissions, fsync ordering and disk-full handling. Test actual competing starts/restores and delayed sql.js saves, failure injection at each stage, and process termination/recovery before claiming production support. None of those requirements is satisfied merely by this scratch suite.
