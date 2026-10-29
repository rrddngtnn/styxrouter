# SQLite restore safety blocker

There is currently **no supported safe offline restore command**. Do not replace `storage.sqlite`, delete its WAL or SHM files, or attempt a manual restore merely because the server appears stopped. The legacy `restoreDbBackup` export deliberately rejects every request; the Hono backups API provides listing and creation, not restore.

## Why restore is blocked

- SQLite locks coordinate participating SQLite connections, not arbitrary file replacement. A checkpoint releases its protection before a close, sidecar cleanup, and rename can finish. A new process can open or write in that interval; an existing connection can retain the old inode while another sees the replacement.
- `apps/server/src/lib/db/adapters/sqljsAdapter.ts` loads an in-memory image with `readFileSync` and persists it using a temporary file and `renameSync`, outside SQLite's locking protocol. A process with a pending save can overwrite a restored database even if a native SQLite exclusive lock was acquired. The server has multiple database opening paths and there is no common lifetime cross-process maintenance lock.
- A service-stop check, PID scan, advisory lock used only by the restore tool, or an operator confirmation cannot establish exclusive control over all existing and future access, including external SQLite clients or other hosts sharing storage. The restore must fail closed when such control cannot be established.

## Requirements before implementing restore

1. Define a supported deployment boundary in which all access to the data directory is controlled and all SQLite and sql.js users participate in a single cross-process maintenance protocol for their entire database lifetime, including initialization, delayed writes, shutdown, and recovery. Prevent new access while restoration runs; account for existing processes, path aliases, external clients and shared filesystems. Where the boundary cannot enforce these conditions, refuse restore. A cooperative lock alone does not exclude nonparticipants.
2. Prove the guard remains effective throughout snapshot, validation, publication, sidecar handling, rollback, and restart handoff. Define platform/filesystem restrictions and fail closed on unsupported or unverifiable environments.
3. Validate the selected backup in isolation, and create and verify a durable pre-restore recovery point that includes committed WAL data. Specify fsync ordering, ownership and permissions, disk-full behavior, and crash recovery before changing the target. Never copy only a live main database file.
4. Define an idempotent, crash-recoverable publication and rollback protocol that preserves a verified recovery copy even if publication, rollback, or the host fails. Do not remove sidecars or reopen the database until the protocol makes them safe.
5. Exercise the complete protocol on disposable databases only: independent native SQLite readers/writers, a delayed sql.js save, competing restores and attempted starts, WAL with committed uncheckpointed data, corrupt backup, failure injection at each publication and rollback stage, and process termination/recovery. Verify data and integrity after each outcome. Existing fail-closed tests are not a substitute for successful-restore or rollback tests.

Until these prerequisites are implemented and verified, the safe behavior is to reject restore, not to offer an operator override.
