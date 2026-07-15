/**
 * Agents domain: agents (with versioning via parent_agent_id), subagents,
 * agent_tools, mcp_servers, user_oauth_connections.
 * Ports: functions/agents_crud.py, agent_subagents_crud.py,
 * agent_tools_crud.py, mcp_servers_crud.py, mcp_oauth_crud.py.
 */
import { many, one, run } from '../client.ts';
import { uuid } from '../../shared/crypto.ts';
import type {
  AgentRow,
  AgentSubagentRow,
  AgentToolRow,
  McpServerRow,
  ToolType,
  UserOauthConnectionRow,
} from '../types.ts';

const AGENT_NAME_RE = /^[a-z0-9_-]+$/;

// ── agents ──────────────────────────────────────────────────────────────────

export async function createAgent(
  db: D1Database,
  input: {
    workspaceId: string;
    name: string;
    description?: string | null;
    instructions?: string | null;
    teamId?: string | null;
    status?: AgentRow['status'];
    parentAgentId?: string | null;
    type?: AgentRow['type'];
    model?: string;
    reasoningEffort?: AgentRow['reasoning_effort'];
    isPublic?: boolean;
    buildTaskId?: string | null;
  },
): Promise<AgentRow> {
  if (!AGENT_NAME_RE.test(input.name)) {
    throw new Error('agent name must match ^[a-z0-9_-]+$');
  }
  const id = uuid();
  await run(
    db,
    `INSERT INTO agents (id, workspace_id, team_id, name, description, instructions, status,
       parent_agent_id, type, model, reasoning_effort, is_public, build_task_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    id, input.workspaceId, input.teamId ?? null, input.name, input.description ?? null,
    input.instructions ?? null, input.status ?? 'draft', input.parentAgentId ?? null,
    input.type ?? 'interactive', input.model ?? 'gpt-5.4', input.reasoningEffort ?? 'medium',
    input.isPublic ? 1 : 0, input.buildTaskId ?? null,
  );
  return (await getAgentById(db, id))!;
}

export function getAgentById(db: D1Database, id: string) {
  return one<AgentRow>(db, `SELECT * FROM agents WHERE id = ?`, id);
}

export function listAgents(
  db: D1Database,
  workspaceId: string,
  filters: { status?: AgentRow['status']; type?: AgentRow['type'] } = {},
) {
  const clauses = ['workspace_id = ?'];
  const binds: unknown[] = [workspaceId];
  if (filters.status) { clauses.push('status = ?'); binds.push(filters.status); }
  if (filters.type) { clauses.push('type = ?'); binds.push(filters.type); }
  return many<AgentRow>(
    db,
    `SELECT * FROM agents WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC`,
    ...binds,
  );
}

/** Versions: root agent + all children sharing that root (agents_get_versions). */
export function getAgentVersions(db: D1Database, rootAgentId: string) {
  return many<AgentRow>(
    db,
    `SELECT * FROM agents WHERE id = ? OR parent_agent_id = ? ORDER BY created_at DESC`,
    rootAgentId, rootAgentId,
  );
}

/** Resolve a published root agent by name within a workspace (agents_resolve_by_name). */
export function resolveAgentByName(db: D1Database, workspaceId: string, name: string) {
  return one<AgentRow>(
    db,
    `SELECT * FROM agents
     WHERE workspace_id = ? AND name = ? AND parent_agent_id IS NULL`,
    workspaceId, name,
  );
}

export async function updateAgent(
  db: D1Database,
  id: string,
  patch: Partial<Pick<AgentRow, 'name' | 'description' | 'instructions' | 'status' | 'team_id' | 'model' | 'reasoning_effort' | 'is_public' | 'type'>>,
) {
  if (patch.name !== undefined && !AGENT_NAME_RE.test(patch.name)) {
    throw new Error('agent name must match ^[a-z0-9_-]+$');
  }
  await run(
    db,
    `UPDATE agents SET
       name = COALESCE(?, name),
       description = COALESCE(?, description),
       instructions = COALESCE(?, instructions),
       status = COALESCE(?, status),
       team_id = COALESCE(?, team_id),
       model = COALESCE(?, model),
       reasoning_effort = COALESCE(?, reasoning_effort),
       is_public = COALESCE(?, is_public),
       type = COALESCE(?, type),
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
     WHERE id = ?`,
    patch.name ?? null, patch.description ?? null, patch.instructions ?? null,
    patch.status ?? null, patch.team_id ?? null, patch.model ?? null,
    patch.reasoning_effort ?? null, patch.is_public ?? null, patch.type ?? null, id,
  );
  return getAgentById(db, id);
}

/**
 * Clone an agent as a new version (agents_clone): child row + copied tools
 * and subagent links, all in one atomic D1 batch.
 */
export async function cloneAgent(db: D1Database, sourceId: string): Promise<AgentRow | null> {
  const src = await getAgentById(db, sourceId);
  if (!src) return null;
  const rootId = src.parent_agent_id ?? src.id;
  const newId = uuid();

  const tools = await listAgentTools(db, sourceId);
  const subs = await many<AgentSubagentRow>(
    db, `SELECT * FROM agent_subagents WHERE parent_agent_id = ?`, sourceId,
  );

  const stmts: D1PreparedStatement[] = [
    db.prepare(
      `INSERT INTO agents (id, workspace_id, team_id, name, description, instructions, status,
         parent_agent_id, type, model, reasoning_effort, is_public)
       VALUES (?,?,?,?,?,?, 'draft', ?, ?, ?, ?, ?)`,
    ).bind(
      newId, src.workspace_id, src.team_id, src.name, src.description, src.instructions,
      rootId, src.type, src.model, src.reasoning_effort, src.is_public,
    ),
    ...tools.map((t) =>
      db.prepare(
        `INSERT INTO agent_tools (id, agent_id, tool_type, mcp_server_id, tool_name,
           custom_description, require_approval, config, allowed_tools, execution_order, enabled)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      ).bind(
        uuid(), newId, t.tool_type, t.mcp_server_id, t.tool_name, t.custom_description,
        t.require_approval, t.config, t.allowed_tools, t.execution_order, t.enabled,
      ),
    ),
    ...subs.map((s) =>
      db.prepare(
        `INSERT INTO agent_subagents (id, parent_agent_id, subagent_id, enabled) VALUES (?,?,?,?)`,
      ).bind(uuid(), newId, s.subagent_id, s.enabled),
    ),
  ];
  await db.batch(stmts);
  return getAgentById(db, newId);
}

export async function deleteAgent(db: D1Database, id: string) {
  const res = await run(db, `DELETE FROM agents WHERE id = ?`, id);
  return res.meta.changes > 0;
}

// ── subagents ───────────────────────────────────────────────────────────────

export function listSubagents(db: D1Database, parentAgentId: string) {
  return many<AgentSubagentRow & { subagent_name: string; subagent_description: string | null }>(
    db,
    `SELECT s.*, a.name AS subagent_name, a.description AS subagent_description
     FROM agent_subagents s JOIN agents a ON a.id = s.subagent_id
     WHERE s.parent_agent_id = ? ORDER BY s.created_at`,
    parentAgentId,
  );
}

/** Published root agents in the workspace not already linked (agent_subagents_get_available). */
export function listAvailableSubagents(db: D1Database, parentAgentId: string, workspaceId: string) {
  return many<AgentRow>(
    db,
    `SELECT * FROM agents
     WHERE workspace_id = ? AND parent_agent_id IS NULL AND id <> ?
       AND id NOT IN (SELECT subagent_id FROM agent_subagents WHERE parent_agent_id = ?)
     ORDER BY name`,
    workspaceId, parentAgentId, parentAgentId,
  );
}

export async function addSubagent(db: D1Database, parentAgentId: string, subagentId: string) {
  const id = uuid();
  await run(
    db,
    `INSERT INTO agent_subagents (id, parent_agent_id, subagent_id) VALUES (?,?,?)
     ON CONFLICT(parent_agent_id, subagent_id) DO UPDATE SET enabled = 1`,
    id, parentAgentId, subagentId,
  );
  return one<AgentSubagentRow>(
    db, `SELECT * FROM agent_subagents WHERE parent_agent_id = ? AND subagent_id = ?`,
    parentAgentId, subagentId,
  );
}

export async function toggleSubagent(db: D1Database, id: string, enabled: boolean) {
  await run(
    db,
    `UPDATE agent_subagents SET enabled = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
    enabled ? 1 : 0, id,
  );
  return one<AgentSubagentRow>(db, `SELECT * FROM agent_subagents WHERE id = ?`, id);
}

export async function removeSubagent(db: D1Database, id: string) {
  const res = await run(db, `DELETE FROM agent_subagents WHERE id = ?`, id);
  return res.meta.changes > 0;
}

// ── agent tools ─────────────────────────────────────────────────────────────

export function listAgentTools(db: D1Database, agentId: string, enabledOnly = false) {
  return many<AgentToolRow>(
    db,
    `SELECT * FROM agent_tools WHERE agent_id = ? ${enabledOnly ? 'AND enabled = 1' : ''}
     ORDER BY COALESCE(execution_order, 999999), created_at`,
    agentId,
  );
}

export async function createAgentTool(
  db: D1Database,
  input: {
    agentId: string;
    toolType: ToolType;
    mcpServerId?: string | null;
    toolName?: string | null;
    customDescription?: string | null;
    requireApproval?: boolean;
    config?: unknown;
    allowedTools?: unknown;
    executionOrder?: number | null;
    enabled?: boolean;
  },
): Promise<AgentToolRow> {
  const id = uuid();
  await run(
    db,
    `INSERT INTO agent_tools (id, agent_id, tool_type, mcp_server_id, tool_name,
       custom_description, require_approval, config, allowed_tools, execution_order, enabled)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    id, input.agentId, input.toolType, input.mcpServerId ?? null, input.toolName ?? null,
    input.customDescription ?? null, input.requireApproval ? 1 : 0,
    input.config !== undefined ? JSON.stringify(input.config) : null,
    input.allowedTools !== undefined ? JSON.stringify(input.allowedTools) : null,
    input.executionOrder ?? null, input.enabled === false ? 0 : 1,
  );
  return (await one<AgentToolRow>(db, `SELECT * FROM agent_tools WHERE id = ?`, id))!;
}

export async function updateAgentTool(
  db: D1Database,
  id: string,
  patch: { customDescription?: string | null; requireApproval?: boolean; config?: unknown; allowedTools?: unknown; enabled?: boolean; executionOrder?: number | null },
) {
  await run(
    db,
    `UPDATE agent_tools SET
       custom_description = COALESCE(?, custom_description),
       require_approval = COALESCE(?, require_approval),
       config = COALESCE(?, config),
       allowed_tools = COALESCE(?, allowed_tools),
       enabled = COALESCE(?, enabled),
       execution_order = COALESCE(?, execution_order),
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
     WHERE id = ?`,
    patch.customDescription ?? null,
    patch.requireApproval === undefined ? null : patch.requireApproval ? 1 : 0,
    patch.config === undefined ? null : JSON.stringify(patch.config),
    patch.allowedTools === undefined ? null : JSON.stringify(patch.allowedTools),
    patch.enabled === undefined ? null : patch.enabled ? 1 : 0,
    patch.executionOrder ?? null,
    id,
  );
  return one<AgentToolRow>(db, `SELECT * FROM agent_tools WHERE id = ?`, id);
}

export async function deleteAgentTool(db: D1Database, id: string) {
  const res = await run(db, `DELETE FROM agent_tools WHERE id = ?`, id);
  return res.meta.changes > 0;
}

// ── mcp servers ─────────────────────────────────────────────────────────────

export function listMcpServers(db: D1Database, workspaceId: string) {
  return many<McpServerRow>(
    db, `SELECT * FROM mcp_servers WHERE workspace_id = ? ORDER BY created_at`, workspaceId,
  );
}

export function getMcpServerById(db: D1Database, id: string) {
  return one<McpServerRow>(db, `SELECT * FROM mcp_servers WHERE id = ?`, id);
}

export async function createMcpServer(
  db: D1Database,
  input: {
    workspaceId: string;
    serverLabel: string;
    serverUrl?: string | null;
    local?: boolean;
    serverDescription?: string | null;
    headers?: Record<string, string> | null;
    requireApproval?: unknown;
  },
): Promise<McpServerRow> {
  const id = uuid();
  await run(
    db,
    `INSERT INTO mcp_servers (id, workspace_id, server_label, server_url, local, server_description, headers, require_approval)
     VALUES (?,?,?,?,?,?,?,?)`,
    id, input.workspaceId, input.serverLabel,
    input.local ? null : input.serverUrl ?? null,
    input.local ? 1 : 0,
    input.serverDescription ?? null,
    input.headers ? JSON.stringify(input.headers) : null,
    input.requireApproval !== undefined ? JSON.stringify(input.requireApproval) : null,
  );
  return (await getMcpServerById(db, id))!;
}

export async function updateMcpServer(
  db: D1Database,
  id: string,
  patch: { serverLabel?: string; serverUrl?: string | null; serverDescription?: string | null; headers?: Record<string, string> | null; requireApproval?: unknown },
) {
  await run(
    db,
    `UPDATE mcp_servers SET
       server_label = COALESCE(?, server_label),
       server_url = COALESCE(?, server_url),
       server_description = COALESCE(?, server_description),
       headers = COALESCE(?, headers),
       require_approval = COALESCE(?, require_approval),
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
     WHERE id = ?`,
    patch.serverLabel ?? null, patch.serverUrl ?? null, patch.serverDescription ?? null,
    patch.headers === undefined ? null : JSON.stringify(patch.headers),
    patch.requireApproval === undefined ? null : JSON.stringify(patch.requireApproval),
    id,
  );
  return getMcpServerById(db, id);
}

export async function deleteMcpServer(db: D1Database, id: string) {
  const res = await run(db, `DELETE FROM mcp_servers WHERE id = ?`, id);
  return res.meta.changes > 0;
}

// ── oauth / bearer connections ──────────────────────────────────────────────

export function listOauthConnections(db: D1Database, workspaceId: string) {
  return many<UserOauthConnectionRow>(
    db,
    `SELECT * FROM user_oauth_connections WHERE workspace_id = ? ORDER BY created_at DESC`,
    workspaceId,
  );
}

export function getOauthConnection(db: D1Database, userId: string, mcpServerId: string) {
  return one<UserOauthConnectionRow>(
    db,
    `SELECT * FROM user_oauth_connections WHERE user_id = ? AND mcp_server_id = ? AND auth_type = 'oauth'`,
    userId, mcpServerId,
  );
}

/**
 * Token used when an agent calls an MCP server: workspace default first,
 * else most recently created (get_oauth_token_for_mcp_server).
 */
export function getTokenForMcpServer(db: D1Database, workspaceId: string, mcpServerId: string) {
  return one<UserOauthConnectionRow>(
    db,
    `SELECT * FROM user_oauth_connections
     WHERE workspace_id = ? AND mcp_server_id = ?
     ORDER BY is_default DESC, created_at DESC LIMIT 1`,
    workspaceId, mcpServerId,
  );
}

export async function upsertOauthToken(
  db: D1Database,
  input: {
    userId: string;
    workspaceId: string;
    mcpServerId: string;
    authType: 'oauth' | 'bearer';
    accessTokenEnc: string;
    refreshTokenEnc?: string | null;
    tokenType?: string;
    tokenName?: string | null;
    expiresAt?: string | null;
    scope?: string[] | null;
    resourceServer?: string | null;
    audience?: string | null;
    providerMetadata?: unknown;
    isDefault?: boolean;
  },
): Promise<UserOauthConnectionRow> {
  if (input.authType === 'oauth') {
    const existing = await getOauthConnection(db, input.userId, input.mcpServerId);
    if (existing) {
      await run(
        db,
        `UPDATE user_oauth_connections SET
           access_token = ?, refresh_token = COALESCE(?, refresh_token),
           token_type = COALESCE(?, token_type), expires_at = ?,
           scope = COALESCE(?, scope), provider_metadata = COALESCE(?, provider_metadata),
           last_refreshed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE id = ?`,
        input.accessTokenEnc, input.refreshTokenEnc ?? null, input.tokenType ?? null,
        input.expiresAt ?? null,
        input.scope ? JSON.stringify(input.scope) : null,
        input.providerMetadata !== undefined ? JSON.stringify(input.providerMetadata) : null,
        existing.id,
      );
      return (await one<UserOauthConnectionRow>(db, `SELECT * FROM user_oauth_connections WHERE id = ?`, existing.id))!;
    }
  }
  const id = uuid();
  await run(
    db,
    `INSERT INTO user_oauth_connections
       (id, user_id, workspace_id, mcp_server_id, auth_type, access_token, refresh_token,
        token_type, token_name, expires_at, scope, resource_server, audience, is_default, provider_metadata)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    id, input.userId, input.workspaceId, input.mcpServerId, input.authType,
    input.accessTokenEnc, input.refreshTokenEnc ?? null, input.tokenType ?? 'Bearer',
    input.tokenName ?? null, input.expiresAt ?? null,
    input.scope ? JSON.stringify(input.scope) : null,
    input.resourceServer ?? null, input.audience ?? null,
    input.isDefault ? 1 : 0,
    JSON.stringify(input.providerMetadata ?? {}),
  );
  return (await one<UserOauthConnectionRow>(db, `SELECT * FROM user_oauth_connections WHERE id = ?`, id))!;
}

export async function setDefaultToken(db: D1Database, workspaceId: string, mcpServerId: string, tokenId: string) {
  await db.batch([
    db.prepare(
      `UPDATE user_oauth_connections SET is_default = 0 WHERE workspace_id = ? AND mcp_server_id = ?`,
    ).bind(workspaceId, mcpServerId),
    db.prepare(`UPDATE user_oauth_connections SET is_default = 1 WHERE id = ?`).bind(tokenId),
  ]);
}

export async function deleteOauthToken(db: D1Database, id: string) {
  const res = await run(db, `DELETE FROM user_oauth_connections WHERE id = ?`, id);
  return res.meta.changes > 0;
}
