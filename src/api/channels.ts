import { Hono } from 'hono';
import type { ApiEnv } from './middleware.ts';
import { assertMembership } from './middleware.ts';
import { createChannel, deleteChannel, deleteChannelIntegration, listChannelIntegrations, listChannelsByWorkspace, markWelcomePending, upsertChannelIntegration } from '../db/repos/tasks.ts';
import { decryptSecret, encryptSecret, randomToken } from '../shared/crypto.ts';
import { buildSlackInstallUrl, exchangeSlackOauthCode, slackJoinChannel, slackListConversations } from '../shared/slack.ts';
import { json } from '../db/client.ts';

const channels = new Hono<ApiEnv>();

channels.get('/workspaces/:workspaceId/channel-integrations', async (c) => {
  const g = await assertMembership(c, c.req.param('workspaceId')); if (g) return g;
  const rows = await listChannelIntegrations(c.env.DB, c.req.param('workspaceId'));
  return c.json({ integrations: rows.map((r) => ({ id: r.id, channel_type: r.channel_type, external_id: r.external_id, created_at: r.created_at })) });
});

channels.post('/workspaces/:workspaceId/channel-integrations/slack/install', async (c) => {
  const g = await assertMembership(c, c.req.param('workspaceId'), ['owner','admin']); if (g) return g;
  if (!c.env.SLACK_CLIENT_ID) return c.json({ error: 'Slack is not configured (SLACK_CLIENT_ID)' }, 501);
  const redirectUri = `${new URL(c.req.url).origin}/api/slack/oauth/callback`;
  const state = `${c.req.param('workspaceId')}:${randomToken(16)}`;
  return c.json({ install_url: buildSlackInstallUrl(c.env.SLACK_CLIENT_ID, redirectUri, state), state });
});

channels.get('/slack/oauth/callback', async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state') ?? '';
  const workspaceId = state.split(':')[0];
  if (!code || !workspaceId) return c.json({ error: 'missing code/state' }, 400);
  if (!c.env.SLACK_CLIENT_ID || !c.env.SLACK_CLIENT_SECRET) return c.json({ error: 'Slack not configured' }, 501);
  const redirectUri = `${new URL(c.req.url).origin}/api/slack/oauth/callback`;
  const res = await exchangeSlackOauthCode(c.env.SLACK_CLIENT_ID, c.env.SLACK_CLIENT_SECRET, code, redirectUri);
  if (!res.ok || !res.access_token || !res.team) return c.json({ error: res.error ?? 'oauth exchange failed' }, 400);
  await upsertChannelIntegration(c.env.DB, { workspaceId, channelType: 'slack', externalId: res.team.id, credentialsJson: JSON.stringify({ bot_token: await encryptSecret(res.access_token, c.env.TOKEN_ENCRYPTION_KEY), bot_user_id: res.bot_user_id ?? '', team_name: res.team.name }) });
  return c.redirect(`${c.env.FRONTEND_URL}/dashboard/integrations?slack=connected`);
});

channels.delete('/workspaces/:workspaceId/channel-integrations/:integrationId', async (c) => {
  const g = await assertMembership(c, c.req.param('workspaceId'), ['owner','admin']); if (g) return g;
  await deleteChannelIntegration(c.env.DB, c.req.param('integrationId'));
  return c.json({ ok: true });
});

channels.get('/workspaces/:workspaceId/channels', async (c) => {
  const g = await assertMembership(c, c.req.param('workspaceId')); if (g) return g;
  return c.json({ channels: await listChannelsByWorkspace(c.env.DB, c.req.param('workspaceId')) });
});

channels.get('/workspaces/:workspaceId/channel-integrations/:integrationId/conversations', async (c) => {
  const g = await assertMembership(c, c.req.param('workspaceId')); if (g) return g;
  const rows = await listChannelIntegrations(c.env.DB, c.req.param('workspaceId'));
  const integration = rows.find((r) => r.id === c.req.param('integrationId'));
  if (!integration) return c.json({ error: 'not found' }, 404);
  const creds = json<Record<string, string>>(integration.credentials, {});
  if (!creds['bot_token']) return c.json({ error: 'integration has no bot token' }, 400);
  const botToken = await decryptSecret(creds['bot_token'], c.env.TOKEN_ENCRYPTION_KEY);
  const res = await slackListConversations(botToken);
  if (!res.ok) return c.json({ error: res.error ?? 'slack error' }, 502);
  return c.json({ conversations: res.channels });
});

channels.post('/workspaces/:workspaceId/channels', async (c) => {
  const g = await assertMembership(c, c.req.param('workspaceId')); if (g) return g;
  const body = await c.req.json<{ channel_integration_id?: string; external_channel_id?: string; external_channel_name?: string; agent_id?: string; is_private?: boolean }>();
  if (!body.channel_integration_id || !body.external_channel_id || !body.agent_id) return c.json({ error: 'channel_integration_id, external_channel_id, agent_id required' }, 400);
  const channel = await createChannel(c.env.DB, { channelIntegrationId: body.channel_integration_id, externalChannelId: body.external_channel_id, externalChannelName: body.external_channel_name ?? null, agentId: body.agent_id, connectedByUserId: c.get('userId'), welcomePending: Boolean(body.is_private) });
  if (!body.is_private) {
    const rows = await listChannelIntegrations(c.env.DB, c.req.param('workspaceId'));
    const integration = rows.find((r) => r.id === body.channel_integration_id);
    const creds = json<Record<string, string>>(integration?.credentials ?? '{}', {});
    if (creds['bot_token']) {
      const botToken = await decryptSecret(creds['bot_token'], c.env.TOKEN_ENCRYPTION_KEY);
      const joinRes = await slackJoinChannel(botToken, body.external_channel_id);
      if (!joinRes.ok && joinRes.error === 'method_not_supported_for_channel_type') await markWelcomePending(c.env.DB, channel.id);
    }
  }
  return c.json({ channel }, 201);
});

channels.delete('/workspaces/:workspaceId/channels/:channelId', async (c) => {
  const g = await assertMembership(c, c.req.param('workspaceId')); if (g) return g;
  await deleteChannel(c.env.DB, c.req.param('channelId'));
  return c.json({ ok: true });
});

export default channels;
