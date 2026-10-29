-- Tombstones survive deletion so an identical recreated cache cannot hide an ABA.
CREATE TABLE IF NOT EXISTS provider_limits_cache_revisions (
  key TEXT PRIMARY KEY,
  revision INTEGER NOT NULL
);
CREATE TRIGGER IF NOT EXISTS provider_limits_cache_revision_insert AFTER INSERT ON key_value
WHEN NEW.namespace = 'providerLimitsCache' BEGIN
  INSERT INTO provider_limits_cache_revisions(key, revision) VALUES (NEW.key, 1)
  ON CONFLICT(key) DO UPDATE SET revision = revision + 1;
END;
CREATE TRIGGER IF NOT EXISTS provider_limits_cache_revision_delete AFTER DELETE ON key_value
WHEN OLD.namespace = 'providerLimitsCache' BEGIN
  INSERT INTO provider_limits_cache_revisions(key, revision) VALUES (OLD.key, 1)
  ON CONFLICT(key) DO UPDATE SET revision = revision + 1;
END;
CREATE TRIGGER IF NOT EXISTS provider_limits_cache_revision_update AFTER UPDATE ON key_value
WHEN OLD.namespace = 'providerLimitsCache' AND (OLD.namespace IS NOT NEW.namespace OR OLD.key IS NOT NEW.key OR OLD.value IS NOT NEW.value) BEGIN
  INSERT INTO provider_limits_cache_revisions(key, revision) VALUES (OLD.key, 1)
  ON CONFLICT(key) DO UPDATE SET revision = revision + 1;
END;
CREATE TRIGGER IF NOT EXISTS provider_limits_cache_revision_update_new AFTER UPDATE ON key_value
WHEN NEW.namespace = 'providerLimitsCache' AND (OLD.namespace IS NOT NEW.namespace OR OLD.key IS NOT NEW.key) BEGIN
  INSERT INTO provider_limits_cache_revisions(key, revision) VALUES (NEW.key, 1)
  ON CONFLICT(key) DO UPDATE SET revision = revision + 1;
END;
