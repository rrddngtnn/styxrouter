-- Durable request deduplication and audit prerequisites for the unmounted
-- webhook provisioning primitive. Existing webhooks and audit rows are untouched.
CREATE TABLE IF NOT EXISTS webhook_provision_requests (
  request_key TEXT PRIMARY KEY NOT NULL,
  fingerprint TEXT NOT NULL,
  webhook_id TEXT NOT NULL
);

-- Match the compliance subsystem's existing lazy-created audit schema. Do not
-- replace an existing audit table or rewrite historical webhook secrets.
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  action TEXT NOT NULL,
  actor TEXT NOT NULL DEFAULT 'system',
  target TEXT,
  details TEXT,
  ip_address TEXT,
  resource_type TEXT,
  status TEXT,
  request_id TEXT,
  metadata TEXT
);
