"""Disposable SQLite experiments, NOT a restore tool; no production paths or arguments.

Every database is created inside a fresh TemporaryDirectory under TMPDIR. These tests
cannot establish operational exclusion, crash durability, or production readiness.
"""
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest


def open_db(path):
    return sqlite3.connect(path, timeout=0.1)


def integrity(db):
    return db.execute('PRAGMA integrity_check').fetchall()


class OfflineRecoveryConstraints(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='styx-offline-sqlite-', dir=os.environ['TMPDIR'])
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.db = self.root / 'storage.sqlite'

    def wal_fixture(self):
        db = open_db(self.db)
        self.addCleanup(db.close)
        self.assertEqual(db.execute('PRAGMA journal_mode=WAL').fetchone()[0], 'wal')
        db.execute('PRAGMA wal_autocheckpoint=0')
        db.execute('CREATE TABLE marker (value TEXT)')
        db.commit()
        self.assertEqual(db.execute('PRAGMA wal_checkpoint(TRUNCATE)').fetchone()[0], 0)
        db.execute("INSERT INTO marker VALUES ('committed-in-wal')")
        db.commit()
        self.assertGreater(Path(str(self.db) + '-wal').stat().st_size, 0)
        return db

    def test_raw_main_copy_loses_committed_wal_but_sqlite_backup_recovers_it(self):
        import shutil
        live = self.wal_fixture()
        raw = self.root / 'raw.sqlite'
        shutil.copyfile(self.db, raw)
        db = open_db(raw)
        try:
            self.assertEqual(db.execute('SELECT value FROM marker').fetchall(), [])
        finally:
            db.close()
        snapshot = self.root / 'snapshot.sqlite'
        target = open_db(snapshot)
        try:
            live.backup(target)
            self.assertEqual(integrity(target), [('ok',)])
        finally:
            target.close()
        # Recovery rehearsal is into a new, unshared scratch DB, never replacement.
        source = open_db(snapshot)
        recovered = open_db(self.root / 'recovered.sqlite')
        try:
            source.backup(recovered)
            self.assertEqual(integrity(recovered), [('ok',)])
            self.assertEqual(recovered.execute('SELECT value FROM marker').fetchall(), [('committed-in-wal',)])
        finally:
            recovered.close()
            source.close()

    def test_corrupt_candidate_fails_before_scratch_recovery(self):
        original = self.wal_fixture()
        candidate = self.root / 'bad.sqlite'
        candidate.write_bytes(b'not a sqlite database')
        scratch_recovery = self.root / 'should-not-exist.sqlite'
        connection = open_db(candidate)
        try:
            with self.assertRaises(sqlite3.DatabaseError):
                integrity(connection)
        finally:
            connection.close()
        self.assertFalse(scratch_recovery.exists())
        self.assertEqual(original.execute('SELECT value FROM marker').fetchall(), [('committed-in-wal',)])

    def test_checkpoint_does_not_prevent_later_external_writer(self):
        db = self.wal_fixture()
        self.assertEqual(db.execute('PRAGMA wal_checkpoint(TRUNCATE)').fetchone()[0], 0)
        script = "import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.execute(\"INSERT INTO marker VALUES ('external')\"); c.commit(); c.close()"
        proc = subprocess.run([sys.executable, '-c', script, str(self.db)], capture_output=True, text=True, timeout=10)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(db.execute('SELECT value FROM marker ORDER BY value').fetchall(), [('committed-in-wal',), ('external',)])

    def test_busy_checkpoint_keeps_wal_data(self):
        writer = self.wal_fixture()
        reader = open_db(self.db)
        try:
            reader.execute('BEGIN')
            self.assertEqual(reader.execute('SELECT value FROM marker').fetchall(), [('committed-in-wal',)])
            writer.execute("INSERT INTO marker VALUES ('after-reader')")
            writer.commit()
            self.assertEqual(writer.execute('PRAGMA wal_checkpoint(TRUNCATE)').fetchone()[0], 1)
            self.assertEqual(writer.execute('SELECT count(*) FROM marker').fetchone()[0], 2)
        finally:
            reader.close()

    def test_external_rename_bypasses_sqlite_exclusive_lock(self):
        old = open_db(self.db)
        self.addCleanup(old.close)
        old.execute('CREATE TABLE marker (value TEXT)')
        old.execute("INSERT INTO marker VALUES ('old')")
        old.commit()
        replacement = self.root / 'pending-save.sqlite'
        new = open_db(replacement)
        new.execute('CREATE TABLE marker (value TEXT)')
        new.execute("INSERT INTO marker VALUES ('external-save')")
        new.commit()
        new.close()
        old.execute('BEGIN EXCLUSIVE')
        script = 'import os,sys; os.replace(sys.argv[1],sys.argv[2])'
        proc = subprocess.run([sys.executable, '-c', script, str(replacement), str(self.db)], capture_output=True, text=True, timeout=10)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(old.execute('SELECT value FROM marker').fetchall(), [('old',)])
        old.rollback()
        check = open_db(self.db)
        try:
            self.assertEqual(check.execute('SELECT value FROM marker').fetchall(), [('external-save',)])
            self.assertEqual(integrity(check), [('ok',)])
        finally:
            check.close()


if __name__ == '__main__':
    unittest.main()
