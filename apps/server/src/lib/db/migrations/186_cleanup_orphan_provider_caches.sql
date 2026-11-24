-- Clean up orphaned connections and caches left behind when a custom
-- provider node or provider connection was deleted before cascading cleanup.

DELETE FROM quota_snapshots
WHERE connection_id IN (
  SELECT id FROM provider_connections
  WHERE (
    provider LIKE 'openai-compatible-chat-%'
    OR provider LIKE 'openai-compatible-responses-%'
    OR provider LIKE 'anthropic-compatible-%'
    OR (length(provider) = 36 AND provider LIKE '________-____-____-____-____________')
  )
  AND provider NOT IN (SELECT id FROM provider_nodes)
);

DELETE FROM proxy_assignments
WHERE scope = 'account'
  AND scope_id IN (
    SELECT id FROM provider_connections
    WHERE (
      provider LIKE 'openai-compatible-chat-%'
      OR provider LIKE 'openai-compatible-responses-%'
      OR provider LIKE 'anthropic-compatible-%'
      OR (length(provider) = 36 AND provider LIKE '________-____-____-____-____________')
    )
    AND provider NOT IN (SELECT id FROM provider_nodes)
  );

DELETE FROM provider_connections
WHERE (
  provider LIKE 'openai-compatible-chat-%'
  OR provider LIKE 'openai-compatible-responses-%'
  OR provider LIKE 'anthropic-compatible-%'
  OR (length(provider) = 36 AND provider LIKE '________-____-____-____-____________')
)
AND provider NOT IN (SELECT id FROM provider_nodes);

DELETE FROM key_value
WHERE namespace = 'providerLimitsCache'
  AND key NOT IN (SELECT id FROM provider_connections);

DELETE FROM key_value
WHERE namespace = 'syncedAvailableModels'
  AND instr(key, ':') > 0
  AND substr(key, instr(key, ':') + 1) NOT IN (SELECT id FROM provider_connections);

DELETE FROM key_value
WHERE namespace IN ('customModels', 'modelCompatOverrides', 'providerAliases', 'proxyConfig')
  AND (
    key LIKE 'openai-compatible-chat-%'
    OR key LIKE 'openai-compatible-responses-%'
    OR key LIKE 'anthropic-compatible-%'
    OR (length(key) = 36 AND key LIKE '________-____-____-____-____________')
  )
  AND key NOT IN (SELECT id FROM provider_nodes);
