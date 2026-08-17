-- Stage 13: durable workspace/provider identity and provider-discovered models.

ALTER TABLE user_oauth_connections ADD COLUMN provider_identity TEXT;

UPDATE user_oauth_connections
SET provider_identity = json_extract(provider_metadata, '$.provider_id')
WHERE auth_type = 'bearer'
  AND json_extract(provider_metadata, '$.kind') = 'model_provider'
  AND json_extract(provider_metadata, '$.provider_id') IS NOT NULL;

-- Older OpenAI bearer rows predate model-provider metadata. Treat the server
-- label as the legacy provider identity before deduplicating the table.
UPDATE user_oauth_connections
SET provider_identity = 'openai',
    provider_metadata = json_set(
      json_set(COALESCE(provider_metadata, '{}'), '$.kind', 'model_provider'),
      '$.provider_id', 'openai'
    )
WHERE auth_type = 'bearer'
  AND provider_identity IS NULL
  AND EXISTS (
    SELECT 1 FROM mcp_servers
    WHERE mcp_servers.id = user_oauth_connections.mcp_server_id
      AND lower(mcp_servers.server_label) IN ('openai', 'model-provider:openai')
  );

UPDATE user_oauth_connections
SET provider_metadata = json_set(provider_metadata, '$.provider_identity', provider_identity)
WHERE provider_identity IS NOT NULL;

-- Keep an explicitly default credential when one exists; otherwise keep the
-- newest record. This makes the new unique index applicable to existing data.
DELETE FROM user_oauth_connections
WHERE id IN (
  SELECT id
  FROM (
    SELECT id,
           row_number() OVER (
             PARTITION BY workspace_id, provider_identity
             ORDER BY is_default DESC, updated_at DESC, created_at DESC, id DESC
           ) AS duplicate_rank
    FROM user_oauth_connections
    WHERE auth_type = 'bearer' AND provider_identity IS NOT NULL
  )
  WHERE duplicate_rank > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_uoc_workspace_provider_identity
  ON user_oauth_connections(workspace_id, provider_identity)
  WHERE auth_type = 'bearer' AND provider_identity IS NOT NULL;

CREATE TABLE IF NOT EXISTS model_provider_models (
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    provider_id TEXT NOT NULL,
    model_id TEXT NOT NULL,
    label TEXT NOT NULL,
    metadata TEXT NOT NULL DEFAULT '{}',
    fetched_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY (workspace_id, provider_id, model_id)
);

CREATE INDEX IF NOT EXISTS idx_model_provider_models_workspace_provider
  ON model_provider_models(workspace_id, provider_id, label);
