import { Hono } from 'hono';
import type { ApiEnv } from './middleware.ts';
import { assertMembership } from './middleware.ts';
import { acceptInvite, createInvite, createTeam, createWorkspace, declineInvite, deleteTeam, deleteWorkspace, getInviteByToken, getTeamsByWorkspace, getUsersByWorkspace, getWorkspaceById, getWorkspacesForUser, listPendingInvites, removeMembership, revokeInvite, updateTeam, updateWorkspace, upsertMembership } from '../db/repos/identity.ts';

const core = new Hono<ApiEnv>();

core.get('/workspaces', async (c) => c.json({ workspaces: await getWorkspacesForUser(c.env.DB, c.get('userId')) }));

core.post('/workspaces', async (c) => {
  const body = await c.req.json<{ name?: string }>();
  if (!body.name) return c.json({ error: 'name required' }, 400);
  return c.json({ workspace: await createWorkspace(c.env.DB, { name: body.name, ownerUserId: c.get('userId') }) }, 201);
});

core.get('/workspaces/:workspaceId', async (c) => {
  const g = await assertMembership(c, c.req.param('workspaceId')); if (g) return g;
  return c.json({ workspace: await getWorkspaceById(c.env.DB, c.req.param('workspaceId')) });
});

core.patch('/workspaces/:workspaceId', async (c) => {
  const g = await assertMembership(c, c.req.param('workspaceId'), ['owner','admin']); if (g) return g;
  const body = await c.req.json<{ name?: string }>();
  if (!body.name) return c.json({ error: 'name required' }, 400);
  return c.json({ workspace: await updateWorkspace(c.env.DB, c.req.param('workspaceId'), body.name) });
});

core.delete('/workspaces/:workspaceId', async (c) => {
  const g = await assertMembership(c, c.req.param('workspaceId'), ['owner']); if (g) return g;
  await deleteWorkspace(c.env.DB, c.req.param('workspaceId'));
  return c.json({ ok: true });
});

core.get('/workspaces/:workspaceId/members', async (c) => {
  const g = await assertMembership(c, c.req.param('workspaceId')); if (g) return g;
  const rows = await getUsersByWorkspace(c.env.DB, c.req.param('workspaceId'));
  return c.json({ members: rows.map((u) => ({ id: u.id, name: u.name, email: u.email, avatar_url: u.avatar_url, role: u.role })) });
});

core.patch('/workspaces/:workspaceId/members/:userId', async (c) => {
  const g = await assertMembership(c, c.req.param('workspaceId'), ['owner','admin']); if (g) return g;
  const body = await c.req.json<{ role?: 'owner'|'admin'|'member' }>();
  if (!body.role) return c.json({ error: 'role required' }, 400);
  return c.json({ membership: await upsertMembership(c.env.DB, { userId: c.req.param('userId'), workspaceId: c.req.param('workspaceId'), role: body.role }) });
});

core.delete('/workspaces/:workspaceId/members/:userId', async (c) => {
  const g = await assertMembership(c, c.req.param('workspaceId'), ['owner','admin']); if (g) return g;
  await removeMembership(c.env.DB, c.req.param('userId'), c.req.param('workspaceId'));
  return c.json({ ok: true });
});

core.get('/workspaces/:workspaceId/teams', async (c) => {
  const g = await assertMembership(c, c.req.param('workspaceId')); if (g) return g;
  return c.json({ teams: await getTeamsByWorkspace(c.env.DB, c.req.param('workspaceId')) });
});

core.post('/workspaces/:workspaceId/teams', async (c) => {
  const g = await assertMembership(c, c.req.param('workspaceId')); if (g) return g;
  const body = await c.req.json<{ name?: string; description?: string; icon?: string }>();
  if (!body.name) return c.json({ error: 'name required' }, 400);
  return c.json({ team: await createTeam(c.env.DB, { workspaceId: c.req.param('workspaceId'), name: body.name, description: body.description, icon: body.icon }) }, 201);
});

core.patch('/workspaces/:workspaceId/teams/:teamId', async (c) => {
  const g = await assertMembership(c, c.req.param('workspaceId')); if (g) return g;
  const body = await c.req.json<{ name?: string; description?: string; icon?: string }>();
  return c.json({ team: await updateTeam(c.env.DB, c.req.param('teamId'), body) });
});

core.delete('/workspaces/:workspaceId/teams/:teamId', async (c) => {
  const g = await assertMembership(c, c.req.param('workspaceId'), ['owner','admin']); if (g) return g;
  await deleteTeam(c.env.DB, c.req.param('teamId'));
  return c.json({ ok: true });
});

core.get('/workspaces/:workspaceId/invites', async (c) => {
  const g = await assertMembership(c, c.req.param('workspaceId'), ['owner','admin']); if (g) return g;
  return c.json({ invites: await listPendingInvites(c.env.DB, c.req.param('workspaceId')) });
});

core.post('/workspaces/:workspaceId/invites', async (c) => {
  const g = await assertMembership(c, c.req.param('workspaceId'), ['owner','admin']); if (g) return g;
  const body = await c.req.json<{ email?: string; role?: 'owner'|'admin'|'member' }>();
  if (!body.email) return c.json({ error: 'email required' }, 400);
  return c.json({ invite: await createInvite(c.env.DB, { workspaceId: c.req.param('workspaceId'), email: body.email, role: body.role ?? 'member', invitedBy: c.get('userId') }) }, 201);
});

core.delete('/workspaces/:workspaceId/invites/:inviteId', async (c) => {
  const g = await assertMembership(c, c.req.param('workspaceId'), ['owner','admin']); if (g) return g;
  await revokeInvite(c.env.DB, c.req.param('inviteId'));
  return c.json({ ok: true });
});

core.get('/invites/:token', async (c) => {
  const invite = await getInviteByToken(c.env.DB, c.req.param('token'));
  if (!invite || invite.status !== 'pending') return c.json({ error: 'invalid invite' }, 404);
  const workspace = await getWorkspaceById(c.env.DB, invite.workspace_id);
  return c.json({ invite: { email: invite.invited_email, role: invite.role, workspace_name: workspace?.name } });
});

core.post('/invites/:token/accept', async (c) => {
  const invite = await acceptInvite(c.env.DB, c.req.param('token'), c.get('userId'));
  if (!invite) return c.json({ error: 'invalid invite' }, 400);
  return c.json({ invite });
});

core.post('/invites/:token/decline', async (c) => {
  return c.json({ invite: await declineInvite(c.env.DB, c.req.param('token')) });
});

export default core;
