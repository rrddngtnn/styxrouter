# Connection cache revision: pending deployment

The cross-process connection-cache fix is source-only and **pending deployment**. Migration `184_connection_cache_revision.sql` extends the existing catalog-context revision to every provider connection insert, update and delete. Cache hits and in-flight cache publications validate that durable revision.

Migration 184 was selected against repository filenames only. Before any deployment, compare every pending migration version and name against the target database's migration ledger, resolve any collision without changing historical migrations, and rehearse the upgrade on an isolated SQLite-consistent copy. This document does not authorize a production database change or service restart.
