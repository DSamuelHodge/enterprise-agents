import { getCloudflareContext } from '@flue/runtime/cloudflare';
import { defineWorkflow, invoke } from '@flue/runtime';
import * as v from 'valibot';
import type { Env } from '../env.d.ts';
import task from '../agents/task.ts';
import { many } from '../db/client.ts';
import evaluateMetric from './evaluate-metric.ts';
import type { TaskRow } from '../db/types.ts';

const inputSchema = v.object({
  workspaceId: v.string(),
  metricDefinitionId: v.string(),
  limit: v.optional(v.number()),
  parentAgentIds: v.optional(v.array(v.string())),
});

export default defineWorkflow({
  agent: task,
  input: inputSchema,
  async run({ input }: { input: v.InferOutput<typeof inputSchema> }) {
    const env = getCloudflareContext().env as unknown as Env;
    const limit = Math.max(1, Math.min(500, input.limit ?? 100));

    let rows: TaskRow[];
    if (input.parentAgentIds?.length) {
      const placeholders = input.parentAgentIds.map(() => '?').join(',');
      rows = await many<TaskRow>(env.DB,
        `SELECT t.* FROM tasks t JOIN agents a ON a.id = t.agent_id WHERE t.workspace_id = ? AND t.status IN ('completed','failed') AND (a.id IN (${placeholders}) OR a.parent_agent_id IN (${placeholders})) ORDER BY t.created_at DESC LIMIT ?`,
        input.workspaceId, ...input.parentAgentIds, ...input.parentAgentIds, limit);
    } else {
      rows = await many<TaskRow>(env.DB,
        `SELECT * FROM tasks WHERE workspace_id = ? AND status IN ('completed','failed') ORDER BY created_at DESC LIMIT ?`,
        input.workspaceId, limit);
    }

    let evaluated = 0;
    const failures: string[] = [];
    for (const t of rows) {
      try {
        await invoke(evaluateMetric, { input: { workspaceId: input.workspaceId, metricDefinitionId: input.metricDefinitionId, taskId: t.id } });
        evaluated += 1;
      } catch (err) { failures.push(`${t.id}: ${String(err)}`); }
    }
    return { total: rows.length, evaluated, failures };
  },
});
