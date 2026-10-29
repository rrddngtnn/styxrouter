# Codex historical refresh freeze

Historical Codex bulk imports were saved as OAuth connections without a durable import marker. Their stored fields can overlap ordinary OAuth connections, and existing metadata is mutable. Do not infer import provenance from names or missing metadata.

Set `STYX_BLOCK_CODEX_REFRESH=1` **on every server process** to explicitly block Codex refresh-token exchange, including historical imports and genuine OAuth accounts. Existing access tokens can continue to be used until they expire or are rejected; users may then need to re-authenticate. Removing the setting reverses the freeze but also restores the historical rotation risk. This setting does not coordinate other applications holding the same refresh token, nor processes running older code or without the setting. Configure before starting every process; no setting can cancel an exchange already in flight.

The freeze does not classify or modify existing rows. Historical imports already consumed or rotated elsewhere cannot be repaired by this setting. Re-authentication is the recommended recovery, but newly authenticated Codex connections also cannot refresh while the freeze is enabled. Existing marked imported-token protections and the bulk-import rejection remain separate.
