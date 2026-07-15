-- D1 (SQLite) initial schema
-- Consolidated port of packages/database/migrations/postgres/001..021.
-- Conversions: UUID -> TEXT (app-generated), JSONB -> TEXT (JSON),
-- TIMESTAMP(TZ) -> TEXT ISO-8601 (UTC), BOOLEAN -> INTEGER 0/1,
-- TEXT[] -> TEXT (JSON array), GIN JSON indexes -> generated columns
-- for the specific keys actually queried (see tasks.slack_thread_ts).
-- updated_at triggers are handled in the repo layer, not DB triggers.

-- ── workspaces ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    is_admin INTEGER NOT NULL DEFAULT 0,                      -- 012
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ── users ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,                -- replaces lower(email) index
    password_hash TEXT NOT NULL,
    avatar_url TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ── user_workspaces ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_workspaces (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner','admin','member')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE(user_id, workspace_id)
);
CREATE INDEX IF NOT EXISTS idx_user_workspaces_user_id ON user_workspaces(user_id);
CREATE INDEX IF NOT EXISTS idx_user_workspaces_workspace_id ON user_workspaces(workspace_id);
CREATE INDEX IF NOT EXISTS idx_user_workspaces_user_role ON user_workspaces(user_id, role);

-- ── teams ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS teams (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    icon TEXT DEFAULT 'Building',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_teams_workspace_id ON teams(workspace_id);

-- ── mcp_servers ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mcp_servers (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    server_label TEXT NOT NULL,
    server_url TEXT,
    local INTEGER NOT NULL DEFAULT 0,
    server_description TEXT,
    headers TEXT,            -- JSON object
    require_approval TEXT,   -- JSON
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    CHECK ((local = 1 AND server_url IS NULL) OR (local = 0 AND server_url IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_mcp_servers_workspace_id ON mcp_servers(workspace_id);
CREATE INDEX IF NOT EXISTS idx_mcp_servers_workspace_label ON mcp_servers(workspace_id, server_label);

-- ── agents ─────────────────────────────────────────────────────────────────
-- Postgres CHECK (name ~ '^[a-z0-9_\-]+$') is enforced in the repo layer;
-- SQLite has GLOB, used here as a close equivalent.
CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    team_id TEXT REFERENCES teams(id) ON DELETE SET NULL,
    name TEXT NOT NULL CHECK (name GLOB '[a-z0-9_-]*' AND length(name) > 0),
    description TEXT,
    instructions TEXT,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('published','draft','archived')),
    parent_agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
    type TEXT NOT NULL DEFAULT 'interactive' CHECK (type IN ('interactive','pipeline')),
    model TEXT NOT NULL DEFAULT 'gpt-5.4' CHECK (length(model) > 0 AND length(model) <= 100),
    reasoning_effort TEXT DEFAULT 'medium' CHECK (reasoning_effort IN ('none','low','medium','high')),
    is_public INTEGER NOT NULL DEFAULT 0,                     -- 004
    build_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL, -- 015
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
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

-- ── agent_subagents ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_subagents (
    id TEXT PRIMARY KEY,
    parent_agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    subagent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE(parent_agent_id, subagent_id)
);
CREATE INDEX IF NOT EXISTS idx_agent_subagents_parent_agent_id ON agent_subagents(parent_agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_subagents_subagent_id ON agent_subagents(subagent_id);

-- ── datasets ───────────────────────────────────────────────────────────────
-- storage_type: 'analytics_engine' replaces 'clickhouse'; 'd1' replaces
-- 'cockroachdb' (transactional context-store path folded into D1 per the
-- migration doc §4.4).
CREATE TABLE IF NOT EXISTS datasets (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (name GLOB '[a-z0-9_-]*' AND length(name) > 0),
    description TEXT,
    storage_type TEXT NOT NULL DEFAULT 'analytics_engine'
      CHECK (storage_type IN ('analytics_engine','d1')),
    storage_config TEXT NOT NULL DEFAULT '{}',                -- JSON
    build_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL, -- 015
    last_updated_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE(workspace_id, name)
);
CREATE INDEX IF NOT EXISTS idx_datasets_workspace_id ON datasets(workspace_id);
CREATE INDEX IF NOT EXISTS idx_datasets_workspace_created ON datasets(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_datasets_build_task_id
  ON datasets(build_task_id) WHERE build_task_id IS NOT NULL;

-- ── agent_tools ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_tools (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    tool_type TEXT NOT NULL CHECK (tool_type IN
      ('file_search','web_search','mcp','code_interpreter','image_generation','local_shell')),
    mcp_server_id TEXT REFERENCES mcp_servers(id) ON DELETE CASCADE,
    tool_name TEXT,
    custom_description TEXT,
    require_approval INTEGER NOT NULL DEFAULT 0,
    config TEXT,          -- JSON
    allowed_tools TEXT,   -- JSON array
    execution_order INTEGER,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    CHECK (tool_type <> 'mcp' OR mcp_server_id IS NOT NULL),
    CHECK (tool_type <> 'mcp' OR tool_name IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_agent_tools_mcp
  ON agent_tools(agent_id, mcp_server_id, tool_name) WHERE tool_type = 'mcp';
CREATE UNIQUE INDEX IF NOT EXISTS ux_agent_tools_simple
  ON agent_tools(agent_id, tool_type) WHERE tool_type NOT IN ('mcp');
CREATE INDEX IF NOT EXISTS idx_agent_tools_agent_id ON agent_tools(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_tools_type_enabled ON agent_tools(agent_id, tool_type, enabled);
CREATE INDEX IF NOT EXISTS idx_agent_tools_enabled
  ON agent_tools(agent_id, tool_type) WHERE enabled = 1;

-- ── user_oauth_connections ─────────────────────────────────────────────────
-- 011 relaxed UNIQUE(user_id, mcp_server_id) to allow multiple bearer tokens:
-- uniqueness is enforced only for auth_type='oauth' via a partial index.
CREATE TABLE IF NOT EXISTS user_oauth_connections (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    mcp_server_id TEXT NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
    auth_type TEXT NOT NULL DEFAULT 'oauth' CHECK (auth_type IN ('oauth','bearer')),
    access_token TEXT NOT NULL,     -- encrypted at rest (AES-GCM, shared/crypto.ts)
    refresh_token TEXT,             -- encrypted at rest
    token_type TEXT NOT NULL DEFAULT 'Bearer',
    token_name TEXT,                                          -- 010
    expires_at TEXT,
    scope TEXT,                     -- JSON array (was TEXT[])
    resource_server TEXT,
    audience TEXT,
    is_default INTEGER NOT NULL DEFAULT 0,
    provider_metadata TEXT NOT NULL DEFAULT '{}',             -- 005 (JSON)
    connected_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    last_refreshed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS unique_user_mcp_oauth
  ON user_oauth_connections(user_id, mcp_server_id) WHERE auth_type = 'oauth';
CREATE INDEX IF NOT EXISTS idx_uoc_user_id ON user_oauth_connections(user_id);
CREATE INDEX IF NOT EXISTS idx_uoc_workspace_id ON user_oauth_connections(workspace_id);
CREATE INDEX IF NOT EXISTS idx_uoc_mcp_server_id ON user_oauth_connections(mcp_server_id);
CREATE INDEX IF NOT EXISTS idx_uoc_expires_at ON user_oauth_connections(expires_at);

-- ── tasks ──────────────────────────────────────────────────────────────────
-- temporal_agent_id / temporal_schedule_id are renamed to flue_* (they now
-- hold the Flue agent instance id / schedule identity). slack_thread_ts is a
-- generated column replacing the Postgres expression index on
-- task_metadata->>'slack_thread_ts' (D1 has no GIN; see migration doc §4.2).
CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    team_id TEXT REFERENCES teams(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'in_progress'
      CHECK (status IN ('in_progress','in_review','closed','completed','failed')),
    agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    assigned_to_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    flue_agent_id TEXT,             -- Flue agent instance id (was temporal_agent_id)
    agent_state TEXT,               -- JSON: complete agent state on completion
    parent_task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
    flue_parent_agent_id TEXT,      -- (was temporal_parent_agent_id)
    task_metadata TEXT NOT NULL DEFAULT '{}',                 -- 006 (JSON)
    slack_thread_ts TEXT GENERATED ALWAYS AS (json_extract(task_metadata,'$.slack_thread_ts')) VIRTUAL,
    view_specs TEXT NOT NULL DEFAULT '[]',                    -- 008 (JSON)
    pattern_specs TEXT NOT NULL DEFAULT '{}',                 -- 014 (JSON)
    schedule_spec TEXT,             -- JSON: {cron | interval | calendars}
    schedule_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
    is_scheduled INTEGER NOT NULL DEFAULT 0,
    schedule_status TEXT DEFAULT 'inactive' CHECK (schedule_status IN ('active','inactive','paused')),
    schedule_next_run_at TEXT,      -- next due time (UTC ISO), maintained by scheduler
    flue_schedule_id TEXT,          -- (was temporal_schedule_id)
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_tasks_workspace_id ON tasks(workspace_id);
CREATE INDEX IF NOT EXISTS idx_tasks_team_id ON tasks(team_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_agent_id ON tasks(agent_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to_id ON tasks(assigned_to_id);
CREATE INDEX IF NOT EXISTS idx_tasks_parent_task_id ON tasks(parent_task_id);
CREATE INDEX IF NOT EXISTS idx_tasks_flue_agent_id ON tasks(flue_agent_id);
CREATE INDEX IF NOT EXISTS idx_tasks_schedule_task_id ON tasks(schedule_task_id);
CREATE INDEX IF NOT EXISTS idx_tasks_workspace_status_created ON tasks(workspace_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_agent_status ON tasks(agent_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_open_workspace
  ON tasks(workspace_id, created_at DESC) WHERE status IN ('in_progress','in_review');
CREATE INDEX IF NOT EXISTS idx_tasks_scheduled_due
  ON tasks(schedule_status, schedule_next_run_at) WHERE is_scheduled = 1;
CREATE INDEX IF NOT EXISTS idx_tasks_slack_thread
  ON tasks(slack_thread_ts) WHERE slack_thread_ts IS NOT NULL;

-- ── metric_definitions ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS metric_definitions (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    category TEXT NOT NULL,
    metric_type TEXT NOT NULL CHECK (metric_type IN ('llm_judge','python_code','formula')),
    config TEXT NOT NULL DEFAULT '{}',   -- JSON
    is_active INTEGER NOT NULL DEFAULT 1,
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE(workspace_id, name)
);
CREATE INDEX IF NOT EXISTS idx_metric_definitions_workspace ON metric_definitions(workspace_id);
CREATE INDEX IF NOT EXISTS idx_metric_definitions_category ON metric_definitions(category);
CREATE INDEX IF NOT EXISTS idx_metric_definitions_active
  ON metric_definitions(is_active) WHERE is_active = 1;

-- ── metric_agents (002) ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS metric_agents (
    id TEXT PRIMARY KEY,
    metric_definition_id TEXT NOT NULL REFERENCES metric_definitions(id) ON DELETE CASCADE,
    parent_agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE(metric_definition_id, parent_agent_id)
);
CREATE INDEX IF NOT EXISTS idx_metric_agents_metric_id ON metric_agents(metric_definition_id);
CREATE INDEX IF NOT EXISTS idx_metric_agents_agent_id ON metric_agents(parent_agent_id);

-- ── password_reset_tokens (013) ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_prt_token ON password_reset_tokens(token);
CREATE INDEX IF NOT EXISTS idx_prt_expires_at ON password_reset_tokens(expires_at);

-- ── workspace_invites (017) ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workspace_invites (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    invited_email TEXT NOT NULL,
    invited_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner','admin','member')),
    token TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined','revoked')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    accepted_at TEXT,
    declined_at TEXT,
    revoked_at TEXT,
    accepted_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_workspace_invites_pending
  ON workspace_invites(workspace_id, invited_email) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_workspace_invites_workspace_status
  ON workspace_invites(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_workspace_invites_token ON workspace_invites(token);

-- ── channel_integrations / channels (019–021) ──────────────────────────────
CREATE TABLE IF NOT EXISTS channel_integrations (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    channel_type TEXT NOT NULL CHECK (channel_type IN ('slack')),
    external_id TEXT NOT NULL,
    credentials TEXT NOT NULL DEFAULT '{}',  -- JSON, encrypted values inside
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE (channel_type, external_id)
);
CREATE INDEX IF NOT EXISTS idx_channel_integrations_workspace
  ON channel_integrations(workspace_id);

CREATE TABLE IF NOT EXISTS channels (
    id TEXT PRIMARY KEY,
    channel_integration_id TEXT NOT NULL REFERENCES channel_integrations(id) ON DELETE CASCADE,
    external_channel_id TEXT NOT NULL,
    external_channel_name TEXT,                               -- 021
    agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    welcome_pending INTEGER NOT NULL DEFAULT 0,               -- 020
    connected_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE (channel_integration_id, external_channel_id, agent_id)
);
CREATE INDEX IF NOT EXISTS idx_channels_lookup
  ON channels(external_channel_id, channel_integration_id);
CREATE INDEX IF NOT EXISTS idx_channels_welcome_pending
  ON channels(channel_integration_id, external_channel_id) WHERE welcome_pending = 1;
