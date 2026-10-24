import importlib.util
import os
from pathlib import Path
import sqlite3
import stat
import tempfile
import threading
import time
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "backup-sqlite.py"
spec = importlib.util.spec_from_file_location("backup_sqlite", SCRIPT)
assert spec is not None and spec.loader is not None
bs = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bs)


SENTINEL = "SENTINEL_VALUE_do_not_leak_1a2b3c"


class BackupSqliteTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=os.environ["TMPDIR"])
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / "live.sqlite"
        with sqlite3.connect(self.source) as conn:
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("CREATE TABLE t (id INTEGER PRIMARY KEY, payload TEXT)")
            conn.executemany("INSERT INTO t(payload) VALUES (?)",
                             [(SENTINEL,) for _ in range(50)])
            conn.commit()
        self.destination = self.root / "backup.sqlite"
        self.report = self.root / "backup-report.json"

    def _row_count(self, path: Path) -> int:
        with sqlite3.connect(f"file:{path}?mode=ro", uri=True) as conn:
            return conn.execute("SELECT COUNT(*) FROM t").fetchone()[0]

    def test_backup_matches_source_and_passes_integrity(self):
        bs.backup(self.source, self.destination, report=self.report)
        self.assertTrue(self.destination.is_file())
        self.assertEqual(stat.S_IMODE(self.destination.stat().st_mode), 0o600)
        self.assertEqual(self._row_count(self.destination), 50)
        with sqlite3.connect(f"file:{self.destination}?mode=ro", uri=True) as conn:
            self.assertEqual(conn.execute("PRAGMA integrity_check").fetchone()[0], "ok")
        report_text = self.report.read_text()
        self.assertIn('"integrity_check": "ok"', report_text)
        self.assertNotIn(SENTINEL, report_text)

    def test_refuses_to_overwrite_existing_destination(self):
        self.destination.write_text("existing")
        with self.assertRaises(FileExistsError):
            bs.backup(self.source, self.destination, report=self.report)
        self.assertEqual(self.destination.read_text(), "existing")

    def test_source_remains_unmodified(self):
        before = self.source.stat().st_mtime_ns
        with sqlite3.connect(f"file:{self.source}?mode=ro", uri=True) as conn:
            source_hash = conn.execute("SELECT md5sum FROM "
                                       "(SELECT group_concat(payload) AS md5sum FROM t)").fetchone()
        bs.backup(self.source, self.destination, report=self.report)
        self.assertEqual(self.source.stat().st_mtime_ns, before)
        with sqlite3.connect(f"file:{self.source}?mode=ro", uri=True) as conn:
            self.assertEqual(conn.execute("SELECT md5sum FROM "
                                          "(SELECT group_concat(payload) AS md5sum FROM t)").fetchone(),
                             source_hash)

    def test_backup_is_consistent_under_concurrent_writes(self):
        stop = threading.Event()
        error = []
        def writer():
            try:
                with sqlite3.connect(self.source, timeout=5.0) as conn:
                    while not stop.is_set():
                        conn.execute("INSERT INTO t(payload) VALUES (?)", (SENTINEL + "-c",))
                        conn.commit()
                        time.sleep(0.002)
            except Exception as err:
                error.append(err)
        thread = threading.Thread(target=writer)
        thread.start()
        try:
            bs.backup(self.source, self.destination, report=self.report)
        finally:
            stop.set()
            thread.join(timeout=5)
        self.assertFalse(error, error)
        with sqlite3.connect(f"file:{self.destination}?mode=ro", uri=True) as conn:
            self.assertEqual(conn.execute("PRAGMA integrity_check").fetchone()[0], "ok")
            count = conn.execute("SELECT COUNT(*) FROM t").fetchone()[0]
        self.assertGreaterEqual(count, 50)

    def test_missing_source_is_reported(self):
        with self.assertRaises(FileNotFoundError):
            bs.backup(self.root / "nope.sqlite", self.destination, report=self.report)

    def test_report_records_byte_counts_and_sha256(self):
        bs.backup(self.source, self.destination, report=self.report)
        text = self.report.read_text()
        for key in ['"source_bytes"', '"backup_bytes"', '"backup_sha256"', '"row_counts"',
                    '"integrity_check": "ok"']:
            self.assertIn(key, text)
        self.assertNotIn(SENTINEL, text)


if __name__ == "__main__":
    unittest.main()
