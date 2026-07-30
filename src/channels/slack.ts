import { createSlackChannel } from '@flue/slack';
import { dispatch } from '@flue/runtime';
import { env as workerEnv } from 'cloudflare:workers';
import type { Env } from '../env.d.ts';
import { json } from '../db/client.ts';
import { consumePendingWelcome, createTask, getChannelIntegrationByExternalId, getSlackTaskByThreadForAgent, getTaskByMetadata, routeChannelEvent, updateTask } from '../db/repos/tasks.ts';
import { decryptSecret } from '../shared/crypto.ts';
import { slackPostMessage } from '../shared/slack.ts';
import task from '../agents/task.ts';
import type { ApiEnv } from '../api/middleware.ts';

export const channel = createSlackChannel<ApiEnv>({
  signingSecret: String((workerEnv as unknown as Env).SLACK_SIGNING_SECRET ?? 'development-slack-signing-secret'),
  async events({ c, payload }) {
    const env = c.env as unknown as Env;
    if (payload.type !== 'event_callback') return;
    const event = payload.event as unknown as Record<string, unknown>;
    if (event['type'] !== 'message' || event['bot_id']) return;
    if (event['subtype']) return;

    const teamId = payload.team_id;
    const channelId = String(event['channel'] ?? '');
    const text = String(event['text'] ?? '');
    if (!text.trim()) return;
    const ts = String(event['ts'] ?? '');
    const threadTs = String(event['thread_ts'] ?? ts);
    const userId = String(event['user'] ?? '');
    const eventId = String(payload.event_id ?? '');

    const integration = await getChannelIntegrationByExternalId(env.DB, 'slack', teamId);
    if (!integration) return;

    const routes = await routeChannelEvent(env.DB, integration.id, channelId);
    if (routes.length === 0) return;

    const creds = json<Record<string, string>>(integration.credentials, {});
    const botToken = creds['bot_token'] ? await decryptSecret(creds['bot_token'], env.TOKEN_ENCRYPTION_KEY) : null;

    for (const route of routes) {
      if (route.welcome_pending === 1 && botToken) {
        const shouldWelcome = await consumePendingWelcome(env.DB, route.id);
        if (shouldWelcome) {
          await slackPostMessage(botToken, { channel: channelId, text: "Hi! I'm connected to this channel — send me a message and I'll pick up the task." });
        }
      }

      const duplicateEvent = eventId ? await getTaskByMetadata(env.DB, integration.workspace_id, 'slack_event_id', `${eventId}:${route.agent_id}`) : null;
      if (duplicateEvent) continue;

      const existing = await getSlackTaskByThreadForAgent(env.DB, integration.workspace_id, threadTs, route.agent_id);
      if (existing) {
        await dispatch(task, { id: existing.id, input: { type: 'task.message', text, source: 'slack', slack_user: userId } });
        if (eventId) {
          await updateTask(env.DB, existing.id, { taskMetadata: { ...json<Record<string, unknown>>(existing.task_metadata, {}), slack_event_id: `${eventId}:${route.agent_id}` } });
        }
        continue;
      }

      const created = await createTask(env.DB, {
        workspaceId: integration.workspace_id,
        agentId: route.agent_id,
        title: text.slice(0, 120) || 'Slack task',
        description: text,
        taskMetadata: { source: 'slack', slack_team_id: teamId, slack_channel: channelId, slack_thread_ts: threadTs, slack_user: userId, ...(eventId ? { slack_event_id: `${eventId}:${route.agent_id}` } : {}) },
      });
      await dispatch(task, { id: created.id, input: { type: 'task.created', task_id: created.id, title: created.title, description: created.description, message: text, source: 'slack' } });
    }
    return undefined;
  },
});

export default channel;
