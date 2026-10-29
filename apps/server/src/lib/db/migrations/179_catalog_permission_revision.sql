-- Catalog permissions change independently of the managed quota-combo projection.
-- Advance a separate durable revision; permission edits must not force a full
-- combo reconciliation. Last-used timestamps and usage counters are excluded.
INSERT OR IGNORE INTO db_meta (key, value) VALUES ('catalog_permission_revision', '1');

CREATE TRIGGER IF NOT EXISTS catalog_permission_revision_key_insert
AFTER INSERT ON api_keys
BEGIN
  UPDATE db_meta SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)
  WHERE key = 'catalog_permission_revision';
END;

CREATE TRIGGER IF NOT EXISTS catalog_permission_revision_key_update
AFTER UPDATE OF key, key_hash, model_access_mode, allowed_models, blocked_models,
  allowed_combos, allowed_connections, allowed_quotas, disable_non_public_models,
  is_active, is_banned, revoked_at, expires_at, scopes, allowed_endpoints ON api_keys
BEGIN
  UPDATE db_meta SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)
  WHERE key = 'catalog_permission_revision';
END;

CREATE TRIGGER IF NOT EXISTS catalog_permission_revision_key_delete
AFTER DELETE ON api_keys
BEGIN
  UPDATE db_meta SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)
  WHERE key = 'catalog_permission_revision';
END;

CREATE TRIGGER IF NOT EXISTS catalog_permission_revision_group_insert
AFTER INSERT ON key_groups
BEGIN
  UPDATE db_meta SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)
  WHERE key = 'catalog_permission_revision';
END;

CREATE TRIGGER IF NOT EXISTS catalog_permission_revision_group_update
AFTER UPDATE OF id, is_active ON key_groups
BEGIN
  UPDATE db_meta SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)
  WHERE key = 'catalog_permission_revision';
END;

CREATE TRIGGER IF NOT EXISTS catalog_permission_revision_group_delete
AFTER DELETE ON key_groups
BEGIN
  UPDATE db_meta SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)
  WHERE key = 'catalog_permission_revision';
END;

CREATE TRIGGER IF NOT EXISTS catalog_permission_revision_rule_insert
AFTER INSERT ON group_model_permissions
BEGIN
  UPDATE db_meta SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)
  WHERE key = 'catalog_permission_revision';
END;

CREATE TRIGGER IF NOT EXISTS catalog_permission_revision_rule_update
AFTER UPDATE OF group_id, model_pattern, provider, access_type ON group_model_permissions
BEGIN
  UPDATE db_meta SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)
  WHERE key = 'catalog_permission_revision';
END;

CREATE TRIGGER IF NOT EXISTS catalog_permission_revision_rule_delete
AFTER DELETE ON group_model_permissions
BEGIN
  UPDATE db_meta SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)
  WHERE key = 'catalog_permission_revision';
END;

CREATE TRIGGER IF NOT EXISTS catalog_permission_revision_member_insert
AFTER INSERT ON key_group_members
BEGIN
  UPDATE db_meta SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)
  WHERE key = 'catalog_permission_revision';
END;

CREATE TRIGGER IF NOT EXISTS catalog_permission_revision_member_update
AFTER UPDATE OF key_id, group_id ON key_group_members
BEGIN
  UPDATE db_meta SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)
  WHERE key = 'catalog_permission_revision';
END;

CREATE TRIGGER IF NOT EXISTS catalog_permission_revision_member_delete
AFTER DELETE ON key_group_members
BEGIN
  UPDATE db_meta SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)
  WHERE key = 'catalog_permission_revision';
END;
