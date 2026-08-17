-- Stage 10: provider-qualified model specifiers and Flue thinking levels.

PRAGMA foreign_keys=off;

CREATE TABLE IF NOT EXISTS agents_new (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    team_id TEXT REFERENCES teams(id) ON DELETE SET NULL,
    name TEXT NOT NULL CHECK (name GLOB '[a-z0-9_-]*' AND length(name) > 0),
    description TEXT,
    instructions TEXT,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('published','draft','archived')),
    parent_agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
    type TEXT NOT NULL DEFAULT 'interactive' CHECK (type IN ('interactive','pipeline')),
    model TEXT NOT NULL DEFAULT 'openai/gpt-5' CHECK (length(model) > 0 AND length(model) <= 180),
    reasoning_effort TEXT DEFAULT 'medium' CHECK (reasoning_effort IN ('none','minimal','low','medium','high','xhigh')),
    is_public INTEGER NOT NULL DEFAULT 0,
    build_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

INSERT INTO agents_new
SELECT
  id,
  workspace_id,
  team_id,
  name,
  description,
  instructions,
  status,
  parent_agent_id,
  type,
  CASE
    WHEN model LIKE '%/%' THEN model
    ELSE 'openai/' || model
  END,
  reasoning_effort,
  is_public,
  build_task_id,
  created_at,
  updated_at
FROM agents;

DROP TABLE agents;
ALTER TABLE agents_new RENAME TO agents;

CREATE INDEX IF NOT EXISTS idx_agents_workspace_id ON agents(workspace_id);
CREATE INDEX IF NOT EXISTS idx_agents_team_id ON agents(team_id);
CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);
CREATE INDEX IF NOT EXISTS idx_agents_type ON agents(type);
CREATE INDEX IF NOT EXISTS idx_agents_parent_id ON agents(parent_agent_id);
CREATE INDEX IF NOT EXISTS idx_agents_workspace_status_created ON agents(workspace_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agents_workspace_name_parent ON agents(workspace_id, name, parent_agent_id);
CREATE INDEX IF NOT EXISTS idx_agents_workspace_type_status ON agents(workspace_id, type, status);
CREATE UNIQUE INDEX IF NOT EXISTS unique_root_agent_name_per_workspace
  ON agents(workspace_id, name) WHERE parent_agent_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_agents_build_task_id
  ON agents(build_task_id) WHERE build_task_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_uoc_workspace_provider_metadata
  ON user_oauth_connections(workspace_id, provider_metadata);

PRAGMA foreign_keys=on;
