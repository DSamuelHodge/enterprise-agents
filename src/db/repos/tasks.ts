/**
 * Tasks domain (incl. schedules), datasets, metric definitions, channels.
 * Ports: functions/tasks_crud.py, schedule_crud.py, datasets_crud.py,
 * metrics_crud.py, channels_crud.py.
 */
import { many, one, run } from '../client.ts';
import { uuid } from '../../shared/crypto.ts';
import type {
  ChannelIntegrationRow,
  ChannelRow,
  DatasetRow,
  MetricDefinitionRow,
  TaskRow,
  TaskStatus,
} from '../types.ts';

// ── tasks ───────────────────────────────────────────────────────────────────

export async function createTask(
  db: D1Database,
  input: {
    workspaceId: string;
    agentId: string;
    title: string;
    description?: string | null;
    teamId?: string | null;
    assignedToId?: string | null;
    parentTaskId?: string | null;
    flueParentAgentId?: string | null;
    taskMetadata?: unknown;
    scheduleSpec?: unknown;
    isScheduled?: boolean;
    scheduleStatus?: 'active' | 'inactive' | 'paused';
    scheduleNextRunAt?: string | null;
    scheduleTaskId?: string | null;
  },
): Promise<TaskRow> {
  const id = uuid();
  await run(
    db,
    `INSERT INTO tasks (id, workspace_id, team_id, title, description, agent_id, assigned_to_id,
       parent_task_id, flue_parent_agent_id, task_metadata, schedule_spec, is_scheduled,
       schedule_status, schedule_next_run_at, schedule_task_id, flue_agent_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    id, input.workspaceId, input.teamId ?? null, input.title, input.description ?? null,
    input.agentId, input.assignedToId ?? null, input.parentTaskId ?? null,
    input.flueParentAgentId ?? null, JSON.stringify(input.taskMetadata ?? {}),
    input.scheduleSpec !== undefined ? JSON.stringify(input.scheduleSpec) : null,
    input.isScheduled ? 1 : 0, input.scheduleStatus ?? 'inactive',
    input.scheduleNextRunAt ?? null, input.scheduleTaskId ?? null,
    // Flue agent instance id == task id: the task agent Durable Object is
    // addressed as /agents/task/<taskId> (replaces temporal_agent_id).
    id,
  );
  return (await getTaskById(db, id))!;
}

export function getTaskById(db: D1Database, id: string) {
  return one<TaskRow>(db, `SELECT * FROM tasks WHERE id = ?`, id);
}

export function getTasksByParent(db: D1Database, parentTaskId: string) {
  return many<TaskRow>(db, `SELECT * FROM tasks WHERE parent_task_id = ? ORDER BY created_at`, parentTaskId);
}

export function listTasks(
  db: D1Database,
  workspaceId: string,
  filters: { status?: TaskStatus; agentId?: string; scheduledOnly?: boolean } = {},
  limit = 200,
) {
  const clauses = ['workspace_id = ?'];
  const binds: unknown[] = [workspaceId];
  if (filters.status) { clauses.push('status = ?'); binds.push(filters.status); }
  if (filters.agentId) { clauses.push('agent_id = ?'); binds.push(filters.agentId); }
  if (filters.scheduledOnly) clauses.push('is_scheduled = 1');
  binds.push(limit);
  return many<TaskRow>(
    db,
    `SELECT * FROM tasks WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC LIMIT ?`,
    ...binds,
  );
}

/** Find task by a task_metadata key/value (tasks_get_by_metadata). Fast path for slack_thread_ts via generated column. */
export function getTaskByMetadata(db: D1Database, workspaceId: string, key: string, value: string) {
  if (key === 'slack_thread_ts') {
    return one<TaskRow>(
      db,
      `SELECT * FROM tasks WHERE workspace_id = ? AND slack_thread_ts = ? ORDER BY created_at DESC`,
      workspaceId, value,
    );
  }
  return one<TaskRow>(
    db,
    `SELECT * FROM tasks WHERE workspace_id = ? AND json_extract(task_metadata, ?) = ?
     ORDER BY created_at DESC`,
    workspaceId, `$.${key}`, value,
  );
}

export async function updateTask(
  db: D1Database,
  id: string,
  patch: {
    title?: string;
    description?: string | null;
    status?: TaskStatus;
    assignedToId?: string | null;
    agentState?: unknown;
    taskMetadata?: unknown;
    viewSpecs?: unknown;
    patternSpecs?: unknown;
    scheduleSpec?: unknown;
    scheduleStatus?: 'active' | 'inactive' | 'paused';
    scheduleNextRunAt?: string | null;
  },
) {
  await run(
    db,
    `UPDATE tasks SET
       title = COALESCE(?, title),
       description = COALESCE(?, description),
       status = COALESCE(?, status),
       assigned_to_id = COALESCE(?, assigned_to_id),
       agent_state = COALESCE(?, agent_state),
       task_metadata = COALESCE(?, task_metadata),
       view_specs = COALESCE(?, view_specs),
       pattern_specs = COALESCE(?, pattern_specs),
       schedule_spec = COALESCE(?, schedule_spec),
       schedule_status = COALESCE(?, schedule_status),
       schedule_next_run_at = COALESCE(?, schedule_next_run_at),
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
     WHERE id = ?`,
    patch.title ?? null, patch.description ?? null, patch.status ?? null,
    patch.assignedToId ?? null,
    patch.agentState === undefined ? null : JSON.stringify(patch.agentState),
    patch.taskMetadata === undefined ? null : JSON.stringify(patch.taskMetadata),
    patch.viewSpecs === undefined ? null : JSON.stringify(patch.viewSpecs),
    patch.patternSpecs === undefined ? null : JSON.stringify(patch.patternSpecs),
    patch.scheduleSpec === undefined ? null : JSON.stringify(patch.scheduleSpec),
    patch.scheduleStatus ?? null, patch.scheduleNextRunAt ?? null,
    id,
  );
  return getTaskById(db, id);
}

export async function deleteTask(db: D1Database, id: string) {
  const res = await run(db, `DELETE FROM tasks WHERE id = ?`, id);
  return res.meta.changes > 0;
}

/** tasks_get_stats: counts per status for a workspace. */
export function getTaskStats(db: D1Database, workspaceId: string) {
  return many<{ status: TaskStatus; count: number }>(
    db,
    `SELECT status, COUNT(*) AS count FROM tasks WHERE workspace_id = ? GROUP BY status`,
    workspaceId,
  );
}

/** Schedules due at/before `now` (drives cron scanner in src/cloudflare.ts). */
export function getDueSchedules(db: D1Database, nowIso: string, limit = 50) {
  return many<TaskRow>(
    db,
    `SELECT * FROM tasks
     WHERE is_scheduled = 1 AND schedule_status = 'active'
       AND schedule_next_run_at IS NOT NULL AND schedule_next_run_at <= ?
     ORDER BY schedule_next_run_at LIMIT ?`,
    nowIso, limit,
  );
}

// ── datasets ────────────────────────────────────────────────────────────────

const DATASET_NAME_RE = /^[a-z0-9_-]+$/;

export async function createDataset(
  db: D1Database,
  input: {
    workspaceId: string;
    name: string;
    description?: string | null;
    storageType?: 'analytics_engine' | 'd1';
    storageConfig?: unknown;
    buildTaskId?: string | null;
  },
): Promise<DatasetRow> {
  if (!DATASET_NAME_RE.test(input.name)) throw new Error('dataset name must match ^[a-z0-9_-]+$');
  const id = uuid();
  await run(
    db,
    `INSERT INTO datasets (id, workspace_id, name, description, storage_type, storage_config, build_task_id)
     VALUES (?,?,?,?,?,?,?)`,
    id, input.workspaceId, input.name, input.description ?? null,
    input.storageType ?? 'analytics_engine', JSON.stringify(input.storageConfig ?? {}),
    input.buildTaskId ?? null,
  );
  return (await one<DatasetRow>(db, `SELECT * FROM datasets WHERE id = ?`, id))!;
}

export function getDatasetById(db: D1Database, id: string) {
  return one<DatasetRow>(db, `SELECT * FROM datasets WHERE id = ?`, id);
}

export function listDatasets(db: D1Database, workspaceId: string) {
  return many<DatasetRow>(
    db, `SELECT * FROM datasets WHERE workspace_id = ? ORDER BY created_at DESC`, workspaceId,
  );
}

export async function updateDataset(
  db: D1Database,
  id: string,
  patch: { description?: string | null; storageConfig?: unknown; touchLastUpdated?: boolean },
) {
  await run(
    db,
    `UPDATE datasets SET
       description = COALESCE(?, description),
       storage_config = COALESCE(?, storage_config),
       last_updated_at = CASE WHEN ? = 1 THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') ELSE last_updated_at END,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
     WHERE id = ?`,
    patch.description ?? null,
    patch.storageConfig === undefined ? null : JSON.stringify(patch.storageConfig),
    patch.touchLastUpdated ? 1 : 0,
    id,
  );
  return getDatasetById(db, id);
}

export async function deleteDataset(db: D1Database, id: string) {
  const res = await run(db, `DELETE FROM datasets WHERE id = ?`, id);
  return res.meta.changes > 0;
}

// ── metric definitions ──────────────────────────────────────────────────────

export async function createMetricDefinition(
  db: D1Database,
  input: {
    workspaceId: string;
    name: string;
    description?: string | null;
    category: string;
    metricType: MetricDefinitionRow['metric_type'];
    config: unknown;
    createdBy?: string | null;
    parentAgentIds?: string[];
  },
): Promise<MetricDefinitionRow> {
  const id = uuid();
  const stmts: D1PreparedStatement[] = [
    db.prepare(
      `INSERT INTO metric_definitions (id, workspace_id, name, description, category, metric_type, config, created_by)
       VALUES (?,?,?,?,?,?,?,?)`,
    ).bind(
      id, input.workspaceId, input.name, input.description ?? null, input.category,
      input.metricType, JSON.stringify(input.config ?? {}), input.createdBy ?? null,
    ),
    ...(input.parentAgentIds ?? []).map((agentId) =>
      db.prepare(
        `INSERT INTO metric_agents (id, metric_definition_id, parent_agent_id) VALUES (?,?,?)`,
      ).bind(uuid(), id, agentId),
    ),
  ];
  await db.batch(stmts);
  return (await one<MetricDefinitionRow>(db, `SELECT * FROM metric_definitions WHERE id = ?`, id))!;
}

export function getMetricDefinitionById(db: D1Database, id: string) {
  return one<MetricDefinitionRow>(db, `SELECT * FROM metric_definitions WHERE id = ?`, id);
}

export function listMetricDefinitions(db: D1Database, workspaceId: string, activeOnly = false) {
  return many<MetricDefinitionRow>(
    db,
    `SELECT * FROM metric_definitions WHERE workspace_id = ? ${activeOnly ? 'AND is_active = 1' : ''}
     ORDER BY created_at DESC`,
    workspaceId,
  );
}

/** Metrics applicable to a task's root agent: linked to it, or unlinked (workspace-wide). */
export function listMetricsForAgent(db: D1Database, workspaceId: string, rootAgentId: string) {
  return many<MetricDefinitionRow>(
    db,
    `SELECT DISTINCT m.* FROM metric_definitions m
     LEFT JOIN metric_agents ma ON ma.metric_definition_id = m.id
     WHERE m.workspace_id = ? AND m.is_active = 1
       AND (ma.id IS NULL OR ma.parent_agent_id = ?)`,
    workspaceId, rootAgentId,
  );
}

export async function updateMetricDefinition(
  db: D1Database,
  id: string,
  patch: { name?: string; description?: string | null; category?: string; config?: unknown; isActive?: boolean },
) {
  await run(
    db,
    `UPDATE metric_definitions SET
       name = COALESCE(?, name),
       description = COALESCE(?, description),
       category = COALESCE(?, category),
       config = COALESCE(?, config),
       is_active = COALESCE(?, is_active),
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
     WHERE id = ?`,
    patch.name ?? null, patch.description ?? null, patch.category ?? null,
    patch.config === undefined ? null : JSON.stringify(patch.config),
    patch.isActive === undefined ? null : patch.isActive ? 1 : 0,
    id,
  );
  return getMetricDefinitionById(db, id);
}

export async function deleteMetricDefinition(db: D1Database, id: string) {
  const res = await run(db, `DELETE FROM metric_definitions WHERE id = ?`, id);
  return res.meta.changes > 0;
}

// ── channels (Slack) ────────────────────────────────────────────────────────

export async function upsertChannelIntegration(
  db: D1Database,
  input: { workspaceId: string; channelType: 'slack'; externalId: string; credentialsJson: string },
): Promise<ChannelIntegrationRow> {
  await run(
    db,
    `INSERT INTO channel_integrations (id, workspace_id, channel_type, external_id, credentials)
     VALUES (?,?,?,?,?)
     ON CONFLICT(channel_type, external_id)
     DO UPDATE SET workspace_id = excluded.workspace_id, credentials = excluded.credentials`,
    uuid(), input.workspaceId, input.channelType, input.externalId, input.credentialsJson,
  );
  return (await one<ChannelIntegrationRow>(
    db,
    `SELECT * FROM channel_integrations WHERE channel_type = ? AND external_id = ?`,
    input.channelType, input.externalId,
  ))!;
}

export function getChannelIntegrationByExternalId(db: D1Database, channelType: 'slack', externalId: string) {
  return one<ChannelIntegrationRow>(
    db,
    `SELECT * FROM channel_integrations WHERE channel_type = ? AND external_id = ?`,
    channelType, externalId,
  );
}

export function listChannelIntegrations(db: D1Database, workspaceId: string) {
  return many<ChannelIntegrationRow>(
    db, `SELECT * FROM channel_integrations WHERE workspace_id = ?`, workspaceId,
  );
}

export async function deleteChannelIntegration(db: D1Database, id: string) {
  const res = await run(db, `DELETE FROM channel_integrations WHERE id = ?`, id);
  return res.meta.changes > 0;
}

export async function createChannel(
  db: D1Database,
  input: {
    channelIntegrationId: string;
    externalChannelId: string;
    externalChannelName?: string | null;
    agentId: string;
    welcomePending?: boolean;
    connectedByUserId?: string | null;
  },
): Promise<ChannelRow> {
  const id = uuid();
  await run(
    db,
    `INSERT INTO channels (id, channel_integration_id, external_channel_id, external_channel_name,
       agent_id, welcome_pending, connected_by_user_id)
     VALUES (?,?,?,?,?,?,?)
     ON CONFLICT(channel_integration_id, external_channel_id, agent_id) DO NOTHING`,
    id, input.channelIntegrationId, input.externalChannelId, input.externalChannelName ?? null,
    input.agentId, input.welcomePending ? 1 : 0, input.connectedByUserId ?? null,
  );
  return (await one<ChannelRow>(
    db,
    `SELECT * FROM channels WHERE channel_integration_id = ? AND external_channel_id = ? AND agent_id = ?`,
    input.channelIntegrationId, input.externalChannelId, input.agentId,
  ))!;
}

/** channel_route_event: which agents should receive an event on this external channel. */
export function routeChannelEvent(db: D1Database, channelIntegrationId: string, externalChannelId: string) {
  return many<ChannelRow>(
    db,
    `SELECT * FROM channels WHERE channel_integration_id = ? AND external_channel_id = ?`,
    channelIntegrationId, externalChannelId,
  );
}

export function listChannelsByIntegration(db: D1Database, channelIntegrationId: string) {
  return many<ChannelRow>(
    db, `SELECT * FROM channels WHERE channel_integration_id = ?`, channelIntegrationId,
  );
}

export function listChannelsByWorkspace(db: D1Database, workspaceId: string) {
  return many<ChannelRow & { channel_type: string; external_id: string }>(
    db,
    `SELECT c.*, ci.channel_type, ci.external_id FROM channels c
     JOIN channel_integrations ci ON ci.id = c.channel_integration_id
     WHERE ci.workspace_id = ?`,
    workspaceId,
  );
}

export async function deleteChannel(db: D1Database, id: string) {
  const res = await run(db, `DELETE FROM channels WHERE id = ?`, id);
  return res.meta.changes > 0;
}

/** channel_consume_pending_welcome: atomically clear and report the flag. */
export async function consumePendingWelcome(db: D1Database, channelId: string): Promise<boolean> {
  const res = await run(
    db, `UPDATE channels SET welcome_pending = 0 WHERE id = ? AND welcome_pending = 1`, channelId,
  );
  return res.meta.changes > 0;
}

export async function markWelcomePending(db: D1Database, channelId: string) {
  await run(db, `UPDATE channels SET welcome_pending = 1 WHERE id = ?`, channelId);
}
