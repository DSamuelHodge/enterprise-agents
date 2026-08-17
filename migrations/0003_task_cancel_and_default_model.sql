-- Stage 11: explicit task cancellation and safer default agent model.

PRAGMA foreign_keys=off;

CREATE TABLE IF NOT EXISTS tasks_new (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    team_id TEXT REFERENCES teams(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'in_progress'
      CHECK (status IN ('in_progress','in_review','closed','completed','failed','cancelled')),
    agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    assigned_to_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    flue_agent_id TEXT,
    agent_state TEXT,
    parent_task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
    flue_parent_agent_id TEXT,
    task_metadata TEXT NOT NULL DEFAULT '{}',
    slack_thread_ts TEXT GENERATED ALWAYS AS (json_extract(task_metadata,'$.slack_thread_ts')) VIRTUAL,
    view_specs TEXT NOT NULL DEFAULT '[]',
    pattern_specs TEXT NOT NULL DEFAULT '{}',
    schedule_spec TEXT,
    schedule_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
    is_scheduled INTEGER NOT NULL DEFAULT 0,
    schedule_status TEXT DEFAULT 'inactive' CHECK (schedule_status IN ('active','inactive','paused')),
    schedule_next_run_at TEXT,
    flue_schedule_id TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

INSERT INTO tasks_new (
  id, workspace_id, team_id, title, description, status, agent_id, assigned_to_id,
  flue_agent_id, agent_state, parent_task_id, flue_parent_agent_id, task_metadata,
  view_specs, pattern_specs, schedule_spec, schedule_task_id, is_scheduled,
  schedule_status, schedule_next_run_at, flue_schedule_id, created_at, updated_at
)
SELECT
  id, workspace_id, team_id, title, description, status, agent_id, assigned_to_id,
  flue_agent_id, agent_state, parent_task_id, flue_parent_agent_id, task_metadata,
  view_specs, pattern_specs, schedule_spec, schedule_task_id, is_scheduled,
  schedule_status, schedule_next_run_at, flue_schedule_id, created_at, updated_at
FROM tasks;

DROP TABLE tasks;
ALTER TABLE tasks_new RENAME TO tasks;

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

UPDATE agents
SET model = 'openai/gpt-5',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE name IN ('build_agent','build')
  AND parent_agent_id IS NULL
  AND model IN ('gpt-5.4','openai/gpt-5.4','openai/gpt-5.4-mini','openai/gpt-5.4-nano');

PRAGMA foreign_keys=on;
