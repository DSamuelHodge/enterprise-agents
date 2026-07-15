import { getCloudflareContext } from '@flue/runtime/cloudflare';
import { defineWorkflow, dispatch } from '@flue/runtime';
import * as v from 'valibot';
import type { Env } from '../env.d.ts';
import task from '../agents/task.ts';
import { createTask, getTaskById } from '../db/repos/tasks.ts';

const inputSchema = v.object({ scheduleTaskId: v.string(), occurrenceIso: v.string() });

export default defineWorkflow({
  agent: task,
  input: inputSchema,
  async run({ input }: { input: v.InferOutput<typeof inputSchema> }) {
    const env = getCloudflareContext().env as unknown as Env;
    const schedule = await getTaskById(env.DB, input.scheduleTaskId);
    if (!schedule || schedule.is_scheduled !== 1) return { started: false, reason: 'schedule task missing', occurrenceTaskId: null };
    if (schedule.schedule_status !== 'active') return { started: false, reason: `schedule is ${schedule.schedule_status}`, occurrenceTaskId: null };

    const occurrence = await createTask(env.DB, {
      workspaceId: schedule.workspace_id,
      agentId: schedule.agent_id,
      title: `${schedule.title} — ${input.occurrenceIso}`,
      description: schedule.description,
      teamId: schedule.team_id,
      scheduleTaskId: schedule.id,
      taskMetadata: { source: 'schedule', schedule_task_id: schedule.id, occurrence: input.occurrenceIso },
    });
    await dispatch(task, { id: occurrence.id, input: { type: 'task.created', task_id: occurrence.id, title: occurrence.title, description: occurrence.description, message: occurrence.description ?? occurrence.title, source: 'schedule' } });
    return { started: true, reason: null, occurrenceTaskId: occurrence.id };
  },
});
