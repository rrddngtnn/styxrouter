-- Every connection write advances the existing durable cross-process generation.
-- Triggers run in the same transaction as the mutation, including bulk writes.
CREATE TRIGGER IF NOT EXISTS connection_cache_revision_insert AFTER INSERT ON provider_connections BEGIN
  UPDATE db_meta SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key = 'catalog_context_revision';
END;
CREATE TRIGGER IF NOT EXISTS connection_cache_revision_update AFTER UPDATE ON provider_connections BEGIN
  UPDATE db_meta SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key = 'catalog_context_revision';
END;
CREATE TRIGGER IF NOT EXISTS connection_cache_revision_delete AFTER DELETE ON provider_connections BEGIN
  UPDATE db_meta SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key = 'catalog_context_revision';
END;
