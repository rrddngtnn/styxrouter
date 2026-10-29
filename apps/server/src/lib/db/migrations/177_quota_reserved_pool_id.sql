-- The revoke marker must never become a resolvable pool identifier.
-- Existing collisions remain inaccessible via quota scope resolution; do not
-- rewrite legacy identifiers or permissions implicitly during migration.
CREATE TRIGGER IF NOT EXISTS quota_pool_reserved_id_insert
BEFORE INSERT ON quota_pools
WHEN NEW.id = '__quota_access_revoked__'
BEGIN
  SELECT RAISE(ABORT, 'reserved quota pool id');
END;

CREATE TRIGGER IF NOT EXISTS quota_pool_reserved_id_update
BEFORE UPDATE OF id ON quota_pools
WHEN NEW.id = '__quota_access_revoked__'
BEGIN
  SELECT RAISE(ABORT, 'reserved quota pool id');
END;
