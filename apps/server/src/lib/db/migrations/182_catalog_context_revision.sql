-- Independent revision for catalog discovery/context state across processes.
INSERT OR IGNORE INTO db_meta (key, value) VALUES ('catalog_context_revision', '1');

CREATE TRIGGER IF NOT EXISTS catalog_context_override_insert AFTER INSERT ON model_context_overrides BEGIN
  UPDATE db_meta SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key = 'catalog_context_revision';
END;
CREATE TRIGGER IF NOT EXISTS catalog_context_override_update AFTER UPDATE ON model_context_overrides BEGIN
  UPDATE db_meta SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key = 'catalog_context_revision';
END;
CREATE TRIGGER IF NOT EXISTS catalog_context_override_delete AFTER DELETE ON model_context_overrides BEGIN
  UPDATE db_meta SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key = 'catalog_context_revision';
END;
CREATE TRIGGER IF NOT EXISTS catalog_context_inventory_insert AFTER INSERT ON key_value
WHEN NEW.namespace = 'syncedAvailableModels' AND NEW.key LIKE 'codex:%' BEGIN
  UPDATE db_meta SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key = 'catalog_context_revision';
END;
CREATE TRIGGER IF NOT EXISTS catalog_context_inventory_update AFTER UPDATE ON key_value
WHEN (OLD.namespace = 'syncedAvailableModels' AND OLD.key LIKE 'codex:%') OR (NEW.namespace = 'syncedAvailableModels' AND NEW.key LIKE 'codex:%') BEGIN
  UPDATE db_meta SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key = 'catalog_context_revision';
END;
CREATE TRIGGER IF NOT EXISTS catalog_context_inventory_delete AFTER DELETE ON key_value
WHEN OLD.namespace = 'syncedAvailableModels' AND OLD.key LIKE 'codex:%' BEGIN
  UPDATE db_meta SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key = 'catalog_context_revision';
END;
CREATE TRIGGER IF NOT EXISTS catalog_context_connection_insert AFTER INSERT ON provider_connections
WHEN NEW.provider = 'codex' BEGIN
  UPDATE db_meta SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key = 'catalog_context_revision';
END;
CREATE TRIGGER IF NOT EXISTS catalog_context_connection_update AFTER UPDATE OF is_active, provider ON provider_connections
WHEN (OLD.provider = 'codex' OR NEW.provider = 'codex') AND (OLD.provider IS NOT NEW.provider OR OLD.is_active IS NOT NEW.is_active) BEGIN
  UPDATE db_meta SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key = 'catalog_context_revision';
END;
CREATE TRIGGER IF NOT EXISTS catalog_context_connection_delete AFTER DELETE ON provider_connections
WHEN OLD.provider = 'codex' BEGIN
  UPDATE db_meta SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key = 'catalog_context_revision';
END;
