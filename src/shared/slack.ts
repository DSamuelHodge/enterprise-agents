/**
 * Slack Web API helpers (fetch-based; runs on workerd).
 * Port of the outbound half of functions/slack_callback.py and slack_api.py.
 * Inbound events are handled by src/channels/slack.ts (Flue channel).
 */

const SLACK_API = 'https://slack.com/api';

async function slackCall<T = Record<string, unknown>>(
  token: string,
  method: string,
  body: Record<string, unknown>,
): Promise<T & { ok: boolean; error?: string }> {
  const res = await fetch(`${SLACK_API}/${method}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(body),
  });
  return (await res.json()) as T & { ok: boolean; error?: string };
}

export function slackPostMessage(
  token: string,
  args: { channel: string; text: string; thread_ts?: string; blocks?: unknown[] },
) {
  return slackCall<{ ts: string; channel: string }>(token, 'chat.postMessage', args);
}

export function slackUpdateMessage(
  token: string,
  args: { channel: string; ts: string; text: string; blocks?: unknown[] },
) {
  return slackCall(token, 'chat.update', args);
}

export function slackAddReaction(token: string, args: { channel: string; timestamp: string; name: string }) {
  return slackCall(token, 'reactions.add', args);
}

export function slackRemoveReaction(token: string, args: { channel: string; timestamp: string; name: string }) {
  return slackCall(token, 'reactions.remove', args);
}

export function slackJoinChannel(token: string, channel: string) {
  return slackCall(token, 'conversations.join', { channel });
}

export function slackListConversations(token: string, cursor?: string) {
  return slackCall<{ channels: Array<{ id: string; name: string; is_private: boolean }>; response_metadata?: { next_cursor?: string } }>(
    token, 'conversations.list',
    { types: 'public_channel,private_channel', limit: 200, ...(cursor ? { cursor } : {}) },
  );
}

/** slack_build_install_url (functions/slack_api.py) */
export function buildSlackInstallUrl(clientId: string, redirectUri: string, state: string): string {
  const scopes = [
    'app_mentions:read', 'channels:history', 'channels:join', 'channels:read',
    'chat:write', 'groups:history', 'groups:read', 'reactions:read', 'reactions:write',
  ].join(',');
  const u = new URL('https://slack.com/oauth/v2/authorize');
  u.searchParams.set('client_id', clientId);
  u.searchParams.set('scope', scopes);
  u.searchParams.set('redirect_uri', redirectUri);
  u.searchParams.set('state', state);
  return u.toString();
}

export function exchangeSlackOauthCode(clientId: string, clientSecret: string, code: string, redirectUri: string) {
  const body = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri });
  return fetch(`${SLACK_API}/oauth.v2.access`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  }).then((r) => r.json() as Promise<{
    ok: boolean;
    error?: string;
    access_token?: string;
    team?: { id: string; name: string };
    bot_user_id?: string;
  }>);
}
