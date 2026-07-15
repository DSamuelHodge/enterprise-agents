import { invoke } from '@flue/runtime';
import type { Env } from './env.d.ts';
import { json, run } from './db/client.ts';
import { getDueSchedules } from './db/repos/tasks.ts';
import { nextRunFromSpec, type ScheduleSpec } from './shared/cron.ts';
import scheduledTask from './workflows/scheduled-task.ts';

export default {
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const now = new Date();
    const due = await getDueSchedules(env.DB, now.toISOString());
    for (const schedule of due) {
      const spec = json<ScheduleSpec | null>(schedule.schedule_spec, null);
      const next = nextRunFromSpec(spec, now);
      const claimed = await run(env.DB,
        `UPDATE tasks SET schedule_next_run_at = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? AND schedule_next_run_at = ?`,
        next ? next.toISOString() : null, schedule.id, schedule.schedule_next_run_at);
      if (claimed.meta.changes === 0) continue;
      ctx.waitUntil(
        invoke(scheduledTask, { input: { scheduleTaskId: schedule.id, occurrenceIso: now.toISOString() } })
          .catch((err: unknown) => console.error(`scheduled-task invoke failed for ${schedule.id}:`, err))
      );
    }
  },
};
