-- Legacy key allowlists do not prove pool-level intent: they may have been
-- edited manually, and empty pools carry no evidence at all. Preserve unknown
-- until an administrator explicitly chooses exclusive true or false.
ALTER TABLE quota_pools ADD COLUMN exclusive INTEGER DEFAULT NULL;
