# File-backed sql.js is disabled

The sql.js adapter cannot safely serve a file-backed database: it loads a private in-memory snapshot and replaces the entire database file on save. A second process or a native SQLite client can change authorization state without the snapshot observing it, and a later save can overwrite those changes. An adapter-only lock would not protect against native clients or older processes.

File-backed sql.js initialization now fails explicitly, including forced sql.js package-boot smoke mode. Install a supported synchronous SQLite driver (`bun:sqlite`, `better-sqlite3`, or `node:sqlite`) to run a persistent server. `:memory:` sql.js remains available. Existing deployments must stop all old sql.js processes before switching drivers; this change cannot protect a database from an already-running older process. Do not share SQLite databases between hosts or on filesystems without reliable SQLite locking.

Re-enabling a file-backed fallback requires an enforceable protocol covering every database accessor and its entire lifetime, including native clients, path aliases, failures and recovery; a cooperative lock used only by sql.js is insufficient.
