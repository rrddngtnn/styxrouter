-- Managed quota combos are projections of pools, groups, and connections.
-- A single durable generation fences every async reconciliation attempt. A
-- worker may build from old data, but its compare-and-write transaction cannot
-- commit after any relevant source mutation.
INSERT OR IGNORE INTO db_meta (key, value) VALUES ('quota_combo_generation', '1');

CREATE TRIGGER IF NOT EXISTS quota_combo_generation_pool_insert
AFTER INSERT ON quota_pools
BEGIN
  UPDATE db_meta SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)
  WHERE key = 'quota_combo_generation';
END;

CREATE TRIGGER IF NOT EXISTS quota_combo_generation_pool_update
AFTER UPDATE OF connection_id, group_id, name ON quota_pools
BEGIN
  UPDATE db_meta SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)
  WHERE key = 'quota_combo_generation';
END;

CREATE TRIGGER IF NOT EXISTS quota_combo_generation_pool_delete
AFTER DELETE ON quota_pools
BEGIN
  UPDATE db_meta SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)
  WHERE key = 'quota_combo_generation';
END;

CREATE TRIGGER IF NOT EXISTS quota_combo_generation_member_insert
AFTER INSERT ON quota_pool_connections
BEGIN
  UPDATE db_meta SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)
  WHERE key = 'quota_combo_generation';
END;

CREATE TRIGGER IF NOT EXISTS quota_combo_generation_member_delete
AFTER DELETE ON quota_pool_connections
BEGIN
  UPDATE db_meta SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)
  WHERE key = 'quota_combo_generation';
END;

CREATE TRIGGER IF NOT EXISTS quota_combo_generation_member_update
AFTER UPDATE OF pool_id, connection_id ON quota_pool_connections
BEGIN
  UPDATE db_meta SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)
  WHERE key = 'quota_combo_generation';
END;

-- Missing group references fall back to the pool name until the group arrives.
-- That INSERT changes the projection just as a rename does.
CREATE TRIGGER IF NOT EXISTS quota_combo_generation_group_insert
AFTER INSERT ON quota_groups
BEGIN
  UPDATE db_meta SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)
  WHERE key = 'quota_combo_generation';
END;

CREATE TRIGGER IF NOT EXISTS quota_combo_generation_group_update
AFTER UPDATE OF id, name ON quota_groups
BEGIN
  UPDATE db_meta SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)
  WHERE key = 'quota_combo_generation';
END;

CREATE TRIGGER IF NOT EXISTS quota_combo_generation_group_delete
AFTER DELETE ON quota_groups
BEGIN
  UPDATE db_meta SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)
  WHERE key = 'quota_combo_generation';
END;

-- A previously missing member connection starts contributing models on INSERT.
CREATE TRIGGER IF NOT EXISTS quota_combo_generation_connection_insert
AFTER INSERT ON provider_connections
BEGIN
  UPDATE db_meta SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)
  WHERE key = 'quota_combo_generation';
END;

CREATE TRIGGER IF NOT EXISTS quota_combo_generation_connection_update
AFTER UPDATE OF provider ON provider_connections
BEGIN
  UPDATE db_meta SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)
  WHERE key = 'quota_combo_generation';
END;

CREATE TRIGGER IF NOT EXISTS quota_combo_generation_connection_delete
AFTER DELETE ON provider_connections
BEGIN
  UPDATE db_meta SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)
  WHERE key = 'quota_combo_generation';
END;
