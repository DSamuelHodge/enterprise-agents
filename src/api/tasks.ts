import { Hono } from 'hono';
import { dispatch, invoke } from '@flue/runtime';
import type { ApiEnv } from './middleware.ts';
import { assertMembership } from './middleware.ts';
import { createTask, deleteTask, getTaskById, getTasksByParent, getTaskStats, listTasks, updateTask } from '../db/repos/tasks.ts';
import { writeTaskMetric } from '../analytics/engine.ts';
import { nextRunFromSpec, type ScheduleSpec } from '../shared/cron.ts';
import task from '../agents/task.ts';
import scheduledTask from '../workflows/scheduled-task.ts';
import type { TaskStatus } from '../db/types.ts';

const tasks = new Hono<ApiEnv>();

tasks.get('/workspaces/:workspaceId/tasks', async (c) => {
  const g = await assertMembership(c, c.req.param('workspaceId')); if (g) return g;
  return c.json({ tasks: await listTasks(c.env.DB, c.req.param('workspaceId'), { status: c.req.query('status') as TaskStatus | undefined, agentId: c.req.query('agent_id') ?? undefined, scheduledOnly: c.req.query('scheduled') === 'true' }) });
});

tasks.get('/workspaces/:workspaceId/tasks/stats', async (c) => {
  const g = await assertMembership(c, c.req.param('workspaceId')); if (g) return g;
  return c.json({ stats: await getTaskStats(c.env.DB, c.req.param('workspaceId')) });
});

tasks.post('/workspaces/:workspaceId/tasks', async (c) => {
  const g = await assertMembership(c, c.req.param('workspaceId')); if (g) return g;
  const body = await c.req.json<Record<string, unknown>>();
  if (!body['agent_id'] || !body['title']) return c.json({ error: 'agent_id and title required' }, 400);
  const scheduleSpec = body['schedule_spec'] as ScheduleSpec | undefined;
  const isScheduled = Boolean(body['is_scheduled']);
  const nextRun = isScheduled ? nextRunFromSpec(scheduleSpec ?? null, new Date()) : null;
  const row = await createTask(c.env.DB, { workspaceId: c.req.param('workspaceId'), agentId: String(body['agent_id']), title: String(body['title']), description: body['description'] as string ?? null, teamId: body['team_id'] as string ?? null, assignedToId: body['assigned_to_id'] as string ?? c.get('userId'), taskMetadata: body['task_metadata'], isScheduled, scheduleSpec, scheduleStatus: isScheduled ? (body['schedule_status'] as 'active'|'paused' ?? 'active') : 'inactive', scheduleNextRunAt: nextRun ? nextRun.toISOString() : null });
  if (!isScheduled) {
    await dispatch(task, { id: row.id, input: { type: 'task.created', task_id: row.id, title: row.title, description: row.description, message: body['initial_message'] as string ?? row.description ?? row.title, source: 'dashboard' } });
  }
  return c.json({ task: row }, 201);
});

tasks.get('/workspaces/:workspaceId/tasks/:taskId', async (c) => {
  const g = await assertMembership(c, c.req.param('workspaceId')); if (g) return g;
  const row = await getTaskById(c.env.DB, c.req.param('taskId'));
  if (!row || row.workspace_id !== c.req.param('workspaceId')) return c.json({ error: 'not found' }, 404);
  return c.json({ task: row, subtasks: await getTasksByParent(c.env.DB, row.id) });
});

tasks.patch('/workspaces/:workspaceId/tasks/:taskId', async (c) => {
  const g = await assertMembership(c, c.req.param('workspaceId')); if (g) return g;
  const body = await c.req.json<Record<string, unknown>>();
  return c.json({ task: await updateTask(c.env.DB, c.req.param('taskId'), { title: body['title'] as string | undefined, description: body['description'] as string | undefined, status: body['status'] as TaskStatus | undefined, assignedToId: body['assigned_to_id'] as string | undefined, taskMetadata: body['task_metadata'], viewSpecs: body['view_specs'], patternSpecs: body['pattern_specs'] }) });
});

tasks.delete('/workspaces/:workspaceId/tasks/:taskId', async (c) => {
  const g = await assertMembership(c, c.req.param('workspaceId')); if (g) return g;
  await deleteTask(c.env.DB, c.req.param('taskId'));
  return c.json({ ok: true });
});

tasks.post('/workspaces/:workspaceId/tasks/:taskId/messages', async (c) => {
  const g = await assertMembership(c, c.req.param('workspaceId')); if (g) return g;
  const row = await getTaskById(c.env.DB, c.req.param('taskId'));
  if (!row || row.workspace_id !== c.req.param('workspaceId')) return c.json({ error: 'not found' }, 404);
  const body = await c.req.json<{ text?: string }>();
  if (!body.text) return c.json({ error: 'text required' }, 400);
  await dispatch(task, { id: row.id, input: { type: 'task.message', text: body.text, source: 'dashboard', user_id: c.get('userId') } });
  return c.json({ ok: true }, 202);
});

tasks.post('/workspaces/:workspaceId/tasks/:taskId/feedback', async (c) => {
  const g = await assertMembership(c, c.req.param('workspaceId')); if (g) return g;
  const row = await getTaskById(c.env.DB, c.req.param('taskId'));
  if (!row || row.workspace_id !== c.req.param('workspaceId')) return c.json({ error: 'not found' }, 404);
  const body = await c.req.json<{ positive?: boolean; comment?: string; response_id?: string }>();
  writeTaskMetric(c.env, { workspaceId: c.req.param('workspaceId'), taskId: row.id, agentId: row.agent_id, metricCategory: 'feedback', metricName: 'user_feedback', responseId: body.response_id, score: body.positive ? 1 : -1, reasoning: body.comment ?? '' });
  return c.json({ ok: true }, 201);
});

tasks.post('/workspaces/:workspaceId/tasks/:taskId/schedule/:action', async (c) => {
  const g = await assertMembership(c, c.req.param('workspaceId')); if (g) return g;
  const row = await getTaskById(c.env.DB, c.req.param('taskId'));
  if (!row || row.workspace_id !== c.req.param('workspaceId') || row.is_scheduled !== 1) return c.json({ error: 'schedule not found' }, 404);
  const action = c.req.param('action');
  if (action === 'pause') return c.json({ task: await updateTask(c.env.DB, row.id, { scheduleStatus: 'paused' }) });
  if (action === 'resume') {
    const next = nextRunFromSpec(JSON.parse(row.schedule_spec ?? 'null'), new Date());
    return c.json({ task: await updateTask(c.env.DB, row.id, { scheduleStatus: 'active', scheduleNextRunAt: next ? next.toISOString() : null }) });
  }
  if (action === 'trigger') {
    const { runId } = await invoke(scheduledTask, { input: { scheduleTaskId: row.id, occurrenceIso: new Date().toISOString() } });
    return c.json({ ok: true, runId }, 202);
  }
  return c.json({ error: 'action must be pause|resume|trigger' }, 400);
});

export default tasks;
