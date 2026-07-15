import { Hono } from 'hono';
import type { ApiEnv } from './middleware.ts';
import { assertMembership } from './middleware.ts';
import { addSubagent, cloneAgent, createAgent, createAgentTool, createMcpServer, deleteAgent, deleteAgentTool, deleteMcpServer, deleteOauthToken, getAgentById, getAgentVersions, getMcpServerById, listAgents, listAgentTools, listAvailableSubagents, listMcpServers, listOauthConnections, listSubagents, removeSubagent, setDefaultToken, toggleSubagent, updateAgent, updateAgentTool, updateMcpServer, upsertOauthToken } from '../db/repos/agents.ts';
import { encryptSecret } from '../shared/crypto.ts';
import type { AgentRow, ToolType } from '../db/types.ts';
import remoteMcpDirectory from '../data/remote_mcp_directory.json' with { type: 'json' };

const agents = new Hono<ApiEnv>();

type RemoteMcpDirectoryEntry = {
  id: string;
  name: string;
  server_label: string;
  server_url: string;
  description?: string;
  tags?: string[];
  auth_type?: string | null;
};

agents.get('/remote-mcp-directory', (c) => {
  const query = (c.req.query('query') ?? '').trim().toLowerCase();
  let entries = remoteMcpDirectory as RemoteMcpDirectoryEntry[];
  if (query) {
    entries = entries.filter((entry) =>
      entry.name.toLowerCase().includes(query) ||
      entry.server_label.toLowerCase().includes(query) ||
      entry.server_url.toLowerCase().includes(query) ||
      (entry.description ?? '').toLowerCase().includes(query) ||
      (entry.tags ?? []).some((tag) => tag.toLowerCase().includes(query))
    );
  }
  return c.json({ entries });
});

agents.get('/workspaces/:workspaceId/agents', async (c) => {
  const g = await assertMembership(c, c.req.param('workspaceId')); if (g) return g;
  return c.json({ agents: await listAgents(c.env.DB, c.req.param('workspaceId'), { status: c.req.query('status') as AgentRow['status'] | undefined, type: c.req.query('type') as AgentRow['type'] | undefined }) });
});

agents.post('/workspaces/:workspaceId/agents', async (c) => {
  const g = await assertMembership(c, c.req.param('workspaceId')); if (g) return g;
  const body = await c.req.json<Record<string, unknown>>();
  try {
    return c.json({ agent: await createAgent(c.env.DB, { workspaceId: c.req.param('workspaceId'), name: String(body['name'] ?? ''), description: body['description'] as string ?? null, instructions: body['instructions'] as string ?? null, teamId: body['team_id'] as string ?? null, status: body['status'] as AgentRow['status'], type: body['type'] as AgentRow['type'], model: body['model'] as string, reasoningEffort: body['reasoning_effort'] as AgentRow['reasoning_effort'], isPublic: Boolean(body['is_public']), buildTaskId: body['build_task_id'] as string ?? null }) }, 201);
  } catch (err) { return c.json({ error: String(err) }, 400); }
});

agents.get('/workspaces/:workspaceId/agents/:agentId', async (c) => {
  const g = await assertMembership(c, c.req.param('workspaceId')); if (g) return g;
  const agent = await getAgentById(c.env.DB, c.req.param('agentId'));
  if (!agent || agent.workspace_id !== c.req.param('workspaceId')) return c.json({ error: 'not found' }, 404);
  return c.json({ agent });
});

agents.get('/workspaces/:workspaceId/agents/:agentId/versions', async (c) => {
  const g = await assertMembership(c, c.req.param('workspaceId')); if (g) return g;
  return c.json({ versions: await getAgentVersions(c.env.DB, c.req.param('agentId')) });
});

agents.post('/workspaces/:workspaceId/agents/:agentId/clone', async (c) => {
  const g = await assertMembership(c, c.req.param('workspaceId')); if (g) return g;
  const agent = await cloneAgent(c.env.DB, c.req.param('agentId'));
  if (!agent) return c.json({ error: 'not found' }, 404);
  return c.json({ agent }, 201);
});

agents.patch('/workspaces/:workspaceId/agents/:agentId', async (c) => {
  const g = await assertMembership(c, c.req.param('workspaceId')); if (g) return g;
  const body = await c.req.json<Record<string, unknown>>();
  try { return c.json({ agent: await updateAgent(c.env.DB, c.req.param('agentId'), body as never) }); }
  catch (err) { return c.json({ error: String(err) }, 400); }
});

agents.delete('/workspaces/:workspaceId/agents/:agentId', async (c) => {
  const g = await assertMembership(c, c.req.param('workspaceId')); if (g) return g;
  await deleteAgent(c.env.DB, c.req.param('agentId'));
  return c.json({ ok: true });
});

agents.get('/workspaces/:workspaceId/agents/:agentId/subagents', async (c) => {
  const g = await assertMembership(c, c.req.param('workspaceId')); if (g) return g;
  return c.json({ subagents: await listSubagents(c.env.DB, c.req.param('agentId')) });
});

agents.get('/workspaces/:workspaceId/agents/:agentId/subagents/available', async (c) => {
  const g = await assertMembership(c, c.req.param('workspaceId')); if (g) return g;
  return c.json({ available: await listAvailableSubagents(c.env.DB, c.req.param('agentId'), c.req.param('workspaceId')) });
});

agents.post('/workspaces/:workspaceId/agents/:agentId/subagents', async (c) => {
  const g = await assertMembership(c, c.req.param('workspaceId')); if (g) return g;
  const body = await c.req.json<{ subagent_id?: string }>();
  if (!body.subagent_id) return c.json({ error: 'subagent_id required' }, 400);
  return c.json({ link: await addSubagent(c.env.DB, c.req.param('agentId'), body.subagent_id) }, 201);
});

agents.patch('/workspaces/:workspaceId/subagent-links/:linkId', async (c) => {
  const g = await assertMembership(c, c.req.param('workspaceId')); if (g) return g;
  const body = await c.req.json<{ enabled?: boolean }>();
  return c.json({ link: await toggleSubagent(c.env.DB, c.req.param('linkId'), body.enabled ?? true) });
});

agents.delete('/workspaces/:workspaceId/subagent-links/:linkId', async (c) => {
  const g = await assertMembership(c, c.req.param('workspaceId')); if (g) return g;
  await removeSubagent(c.env.DB, c.req.param('linkId'));
  return c.json({ ok: true });
});

agents.get('/workspaces/:workspaceId/agents/:agentId/tools', async (c) => {
  const g = await assertMembership(c, c.req.param('workspaceId')); if (g) return g;
  return c.json({ tools: await listAgentTools(c.env.DB, c.req.param('agentId')) });
});

agents.post('/workspaces/:workspaceId/agents/:agentId/tools', async (c) => {
  const g = await assertMembership(c, c.req.param('workspaceId')); if (g) return g;
  const body = await c.req.json<Record<string, unknown>>();
  try {
    return c.json({ tool: await createAgentTool(c.env.DB, { agentId: c.req.param('agentId'), toolType: body['tool_type'] as ToolType, mcpServerId: body['mcp_server_id'] as string ?? null, toolName: body['tool_name'] as string ?? null, customDescription: body['custom_description'] as string ?? null, requireApproval: Boolean(body['require_approval']), config: body['config'], allowedTools: body['allowed_tools'], executionOrder: body['execution_order'] as number ?? null, enabled: body['enabled'] !== false }) }, 201);
  } catch (err) { return c.json({ error: String(err) }, 400); }
});

agents.patch('/workspaces/:workspaceId/agent-tools/:toolId', async (c) => {
  const g = await assertMembership(c, c.req.param('workspaceId')); if (g) return g;
  const body = await c.req.json<Record<string, unknown>>();
  return c.json({ tool: await updateAgentTool(c.env.DB, c.req.param('toolId'), { customDescription: body['custom_description'] as string | undefined, requireApproval: body['require_approval'] as boolean | undefined, config: body['config'], allowedTools: body['allowed_tools'], enabled: body['enabled'] as boolean | undefined, executionOrder: body['execution_order'] as number | undefined }) });
});

agents.delete('/workspaces/:workspaceId/agent-tools/:toolId', async (c) => {
  const g = await assertMembership(c, c.req.param('workspaceId')); if (g) return g;
  await deleteAgentTool(c.env.DB, c.req.param('toolId'));
  return c.json({ ok: true });
});

agents.get('/workspaces/:workspaceId/mcp-servers', async (c) => {
  const g = await assertMembership(c, c.req.param('workspaceId')); if (g) return g;
  return c.json({ mcp_servers: await listMcpServers(c.env.DB, c.req.param('workspaceId')) });
});

agents.get('/mcp-servers/:serverId', async (c) => {
  const server = await getMcpServerById(c.env.DB, c.req.param('serverId'));
  if (!server) return c.json({ error: 'not found' }, 404);
  const g = await assertMembership(c, server.workspace_id); if (g) return g;
  return c.json({ mcp_server: server });
});

agents.post('/workspaces/:workspaceId/mcp-servers', async (c) => {
  const g = await assertMembership(c, c.req.param('workspaceId')); if (g) return g;
  const body = await c.req.json<Record<string, unknown>>();
  if (!body['server_label']) return c.json({ error: 'server_label required' }, 400);
  return c.json({ mcp_server: await createMcpServer(c.env.DB, { workspaceId: c.req.param('workspaceId'), serverLabel: String(body['server_label']), serverUrl: body['server_url'] as string ?? null, local: Boolean(body['local']), serverDescription: body['server_description'] as string ?? null, headers: body['headers'] as Record<string,string> ?? null, requireApproval: body['require_approval'] }) }, 201);
});

agents.patch('/workspaces/:workspaceId/mcp-servers/:serverId', async (c) => {
  const g = await assertMembership(c, c.req.param('workspaceId')); if (g) return g;
  const body = await c.req.json<Record<string, unknown>>();
  return c.json({ mcp_server: await updateMcpServer(c.env.DB, c.req.param('serverId'), { serverLabel: body['server_label'] as string | undefined, serverUrl: body['server_url'] as string | undefined, serverDescription: body['server_description'] as string | undefined, headers: body['headers'] as Record<string,string> | undefined, requireApproval: body['require_approval'] }) });
});

agents.delete('/workspaces/:workspaceId/mcp-servers/:serverId', async (c) => {
  const g = await assertMembership(c, c.req.param('workspaceId')); if (g) return g;
  await deleteMcpServer(c.env.DB, c.req.param('serverId'));
  return c.json({ ok: true });
});

agents.get('/workspaces/:workspaceId/oauth-connections', async (c) => {
  const g = await assertMembership(c, c.req.param('workspaceId')); if (g) return g;
  const rows = await listOauthConnections(c.env.DB, c.req.param('workspaceId'));
  return c.json({ connections: rows.map((r) => ({ id: r.id, mcp_server_id: r.mcp_server_id, auth_type: r.auth_type, token_name: r.token_name, is_default: r.is_default === 1, expires_at: r.expires_at, connected_at: r.connected_at })) });
});

agents.post('/workspaces/:workspaceId/oauth-connections', async (c) => {
  const g = await assertMembership(c, c.req.param('workspaceId')); if (g) return g;
  const body = await c.req.json<Record<string, unknown>>();
  if (!body['mcp_server_id'] || !body['access_token']) return c.json({ error: 'mcp_server_id and access_token required' }, 400);
  const conn = await upsertOauthToken(c.env.DB, { userId: c.get('userId'), workspaceId: c.req.param('workspaceId'), mcpServerId: String(body['mcp_server_id']), authType: body['auth_type'] as 'oauth'|'bearer' ?? 'bearer', accessTokenEnc: await encryptSecret(String(body['access_token']), c.env.TOKEN_ENCRYPTION_KEY), refreshTokenEnc: body['refresh_token'] ? await encryptSecret(String(body['refresh_token']), c.env.TOKEN_ENCRYPTION_KEY) : null, tokenType: body['token_type'] as string ?? 'Bearer', tokenName: body['token_name'] as string ?? null, expiresAt: body['expires_at'] as string ?? null, scope: body['scope'] as string[] ?? null, providerMetadata: body['provider_metadata'], isDefault: Boolean(body['is_default']) });
  return c.json({ connection: { id: conn.id, auth_type: conn.auth_type, token_name: conn.token_name } }, 201);
});

agents.post('/workspaces/:workspaceId/oauth-connections/:tokenId/default', async (c) => {
  const g = await assertMembership(c, c.req.param('workspaceId')); if (g) return g;
  const body = await c.req.json<{ mcp_server_id?: string }>();
  if (!body.mcp_server_id) return c.json({ error: 'mcp_server_id required' }, 400);
  await setDefaultToken(c.env.DB, c.req.param('workspaceId'), body.mcp_server_id, c.req.param('tokenId'));
  return c.json({ ok: true });
});

agents.delete('/workspaces/:workspaceId/oauth-connections/:tokenId', async (c) => {
  const g = await assertMembership(c, c.req.param('workspaceId')); if (g) return g;
  await deleteOauthToken(c.env.DB, c.req.param('tokenId'));
  return c.json({ ok: true });
});

export default agents;
