import { connectMcpServer } from '@flue/runtime';
import type { Env } from '../env.d.ts';
import { json } from '../db/client.ts';
import { getMcpServerById, getTokenForMcpServer, listAgentTools } from '../db/repos/agents.ts';
import { decryptSecret } from './crypto.ts';

export interface McpAssemblyResult {
  tools: unknown[];
  skipped: string[];
}

export async function assembleMcpTools(
  env: Env,
  agentId: string,
  workspaceId: string,
): Promise<McpAssemblyResult> {
  const rows = await listAgentTools(env.DB, agentId, true);
  const mcpRows = rows.filter((r) => r.tool_type === 'mcp' && r.mcp_server_id);

  const byServer = new Map<string, typeof mcpRows>();
  for (const row of mcpRows) {
    const list = byServer.get(row.mcp_server_id!) ?? [];
    list.push(row);
    byServer.set(row.mcp_server_id!, list);
  }

  const tools: unknown[] = [];
  const skipped: string[] = [];

  for (const [serverId, toolRows] of byServer) {
    const server = await getMcpServerById(env.DB, serverId);
    if (!server) { skipped.push(serverId); continue; }
    if (server.local === 1 || !server.server_url) { skipped.push(server.server_label); continue; }

    const headers: Record<string, string> = { ...json<Record<string, string>>(server.headers, {}) };

    const conn = await getTokenForMcpServer(env.DB, workspaceId, serverId);
    if (conn) {
      try {
        const token = await decryptSecret(conn.access_token, env.TOKEN_ENCRYPTION_KEY);
        headers['Authorization'] = `${conn.token_type || 'Bearer'} ${token}`;
      } catch {
        skipped.push(`${server.server_label} (credential decrypt failed)`);
        continue;
      }
    }

    const allowed = new Set(
      toolRows.flatMap((r) => json<string[]>(r.allowed_tools, r.tool_name ? [r.tool_name] : [])),
    );

    try {
      const connection = await connectMcpServer(server.server_label, { url: server.server_url, headers });
      const serverTools = (connection.tools as Array<{ name: string }>).filter(
        (t) => allowed.size === 0 || allowed.has(t.name),
      );
      tools.push(...serverTools);
    } catch (err) {
      skipped.push(`${server.server_label} (${String(err)})`);
    }
  }

  return { tools, skipped };
}
