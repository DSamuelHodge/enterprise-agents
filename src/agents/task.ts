import { defineAgent, defineTool, dispatch } from '@flue/runtime';
import * as v from 'valibot';
import type { Env } from '../env.d.ts';
import { json } from '../db/client.ts';
import { getAgentById, listSubagents } from '../db/repos/agents.ts';
import { createTask, getTaskById, getTasksByParent, updateTask, getChannelIntegrationByExternalId } from '../db/repos/tasks.ts';
import { assembleMcpTools } from '../shared/mcp.ts';
import { writeTaskMetric } from '../analytics/engine.ts';
import { TraceRecorder } from '../analytics/tracing.ts';
import { decryptSecret } from '../shared/crypto.ts';
import { slackPostMessage } from '../shared/slack.ts';

const BASE_INSTRUCTIONS = `You are a task agent operating inside a workspace platform.
Each conversation is bound to exactly one task. Your first action on any new
task MUST be to call get_task_context — it returns the task briefing: the
role-specific instructions authored for your agent definition, the task title
and description, available subagents, and integration context. Follow the
role instructions from the briefing as if they were part of this system prompt.

Operating rules:
- Keep the task row up to date: call update_task_status when you complete or fail.
- For separable pieces of work, delegate via create_subtask; only complete a
  parent pipeline task after its subtasks are complete.
- If the briefing includes Slack context, post updates with notify_slack_thread.
- Be concise in status updates; put substantive results in your replies.`;

export const task = defineAgent<Env>(({ id, env }) => ({
  model: env.DEFAULT_MODEL,
  instructions: BASE_INSTRUCTIONS,
  tools: [
    defineTool({
      name: 'get_task_context',
      description: 'Load the briefing for this task: role instructions, task fields, subagents, integration metadata. Call this first.',
      input: v.object({}),
      async run() {
        const taskRow = await getTaskById(env.DB, id);
        if (!taskRow) return { error: `no task row for ${id}` };
        const agentRow = await getAgentById(env.DB, taskRow.agent_id);
        const subs = agentRow ? await listSubagents(env.DB, agentRow.id) : [];
        return {
          task: { id: taskRow.id, title: taskRow.title, description: taskRow.description, status: taskRow.status, parent_task_id: taskRow.parent_task_id, metadata: json(taskRow.task_metadata, {}) },
          role: agentRow ? { agent_id: agentRow.id, name: agentRow.name, type: agentRow.type, model: agentRow.model, reasoning_effort: agentRow.reasoning_effort, instructions: agentRow.instructions } : null,
          subagents: subs.filter((s) => s.enabled === 1).map((s) => ({ agent_id: s.subagent_id, name: s.subagent_name, description: s.subagent_description })),
        };
      },
    }),

    defineTool({
      name: 'connect_tools',
      description: "Connect this agent's configured MCP servers and return tool names available.",
      input: v.object({}),
      async run() {
        const taskRow = await getTaskById(env.DB, id);
        if (!taskRow) return { error: `no task row for ${id}` };
        const { tools, skipped } = await assembleMcpTools(env, taskRow.agent_id, taskRow.workspace_id);
        return { connected_tools: (tools as Array<{ name?: string }>).map((t) => t.name ?? 'unknown'), skipped };
      },
    }),

    defineTool({
      name: 'update_task_status',
      description: 'Update the task status. Statuses: in_progress, in_review, completed, failed, closed.',
      input: v.object({ status: v.picklist(['in_progress','in_review','completed','failed','closed']), summary: v.optional(v.string()) }),
      async run({ input }) {
        const taskRow = await getTaskById(env.DB, id);
        if (!taskRow) return { error: `no task row for ${id}` };
        if (input.status === 'completed') {
          const children = await getTasksByParent(env.DB, id);
          const open = children.filter((c) => c.status === 'in_progress' || c.status === 'in_review');
          if (open.length > 0) return { error: 'cannot complete: open subtasks remain', open_subtasks: open.map((c) => ({ id: c.id, title: c.title, status: c.status })) };
        }
        const updated = await updateTask(env.DB, id, {
          status: input.status,
          agentState: (input.status === 'completed' || input.status === 'failed') ? { summary: input.summary ?? null, finished_at: new Date().toISOString() } : undefined,
        });
        if (updated && (input.status === 'completed' || input.status === 'failed')) {
          const startedMs = Date.parse(updated.created_at);
          writeTaskMetric(env, { workspaceId: updated.workspace_id, taskId: updated.id, agentId: updated.agent_id, metricCategory: 'performance', status: input.status, durationMs: Number.isFinite(startedMs) ? Date.now() - startedMs : 0 });
          if (updated.parent_task_id) {
            await dispatch(task, { id: updated.parent_task_id, input: { type: 'subtask.finished', subtask_id: updated.id, title: updated.title, status: input.status, summary: input.summary ?? null } });
          }
        }
        return { ok: true, status: input.status };
      },
    }),

    defineTool({
      name: 'create_subtask',
      description: 'Create a child task handled by a subagent agent_id from the briefing.',
      input: v.object({ agent_id: v.pipe(v.string(), v.minLength(1)), title: v.pipe(v.string(), v.minLength(1)), description: v.optional(v.string()), initial_message: v.optional(v.string()) }),
      async run({ input }) {
        const parent = await getTaskById(env.DB, id);
        if (!parent) return { error: `no task row for ${id}` };
        const child = await createTask(env.DB, { workspaceId: parent.workspace_id, agentId: input.agent_id, title: input.title, description: input.description ?? null, parentTaskId: parent.id, flueParentAgentId: parent.flue_agent_id, teamId: parent.team_id });
        await dispatch(task, { id: child.id, input: { type: 'task.created', task_id: child.id, title: child.title, description: child.description, parent_task_id: parent.id, message: input.initial_message ?? child.description ?? child.title } });
        return { subtask_id: child.id, status: child.status };
      },
    }),

    defineTool({
      name: 'list_subtasks',
      description: "List this task's subtasks with their current status.",
      input: v.object({}),
      async run() {
        const children = await getTasksByParent(env.DB, id);
        return { subtasks: children.map((c) => ({ id: c.id, title: c.title, status: c.status, agent_id: c.agent_id })) };
      },
    }),

    defineTool({
      name: 'notify_slack_thread',
      description: 'Post a progress update to the Slack thread this task originated from.',
      input: v.object({ text: v.pipe(v.string(), v.minLength(1)) }),
      async run({ input }) {
        const taskRow = await getTaskById(env.DB, id);
        if (!taskRow) return { error: `no task row for ${id}` };
        const meta = json<Record<string, string>>(taskRow.task_metadata, {});
        const channel = meta['slack_channel'], threadTs = meta['slack_thread_ts'], teamId = meta['slack_team_id'];
        if (!channel || !teamId) return { error: 'task has no Slack context' };
        const integration = await getChannelIntegrationByExternalId(env.DB, 'slack', teamId);
        if (!integration) return { error: 'Slack integration not found for team' };
        const creds = json<Record<string, string>>(integration.credentials, {});
        if (!creds['bot_token']) return { error: 'Slack integration has no bot token' };
        const botToken = await decryptSecret(creds['bot_token'], env.TOKEN_ENCRYPTION_KEY);
        const res = await slackPostMessage(botToken, { channel, text: input.text, ...(threadTs ? { thread_ts: threadTs } : {}) });
        return res.ok ? { ok: true, ts: res.ts } : { error: res.error ?? 'slack error' };
      },
    }),

    defineTool({
      name: 'record_trace_note',
      description: 'Record a trace span for observability.',
      input: v.object({ span_type: v.pipe(v.string(), v.minLength(1)), name: v.pipe(v.string(), v.minLength(1)), payload: v.optional(v.record(v.string(), v.unknown())) }),
      async run({ input }) {
        const taskRow = await getTaskById(env.DB, id);
        if (!taskRow) return { error: `no task row for ${id}` };
        const recorder = new TraceRecorder(env, { workspaceId: taskRow.workspace_id, taskId: taskRow.id, agentId: taskRow.agent_id });
        recorder.startSpan(input.span_type, input.name).end(input.payload ?? {});
        return { ok: true };
      },
    }),
  ],
}));

export default task;
