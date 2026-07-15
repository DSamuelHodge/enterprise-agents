import { Hono } from 'hono';
import type { ApiEnv } from './middleware.ts';
import { requireUser } from './middleware.ts';
import { consumePasswordResetToken, createPasswordResetToken, createUser, createWorkspace, getUserByEmail, getUserById, getWorkspacesForUser, updateUser } from '../db/repos/identity.ts';
import { hashPassword, signSession, verifyPassword } from '../shared/crypto.ts';

const auth = new Hono<ApiEnv>();

auth.post('/signup', async (c) => {
  const body = await c.req.json<{ name?: string; email?: string; password?: string; workspaceName?: string }>();
  if (!body.name || !body.email || !body.password) return c.json({ error: 'name, email, password required' }, 400);
  if (body.password.length < 8) return c.json({ error: 'password must be at least 8 characters' }, 400);
  if (await getUserByEmail(c.env.DB, body.email)) return c.json({ error: 'email already registered' }, 409);
  const user = await createUser(c.env.DB, { name: body.name, email: body.email, passwordHash: await hashPassword(body.password) });
  const workspace = await createWorkspace(c.env.DB, { name: body.workspaceName ?? `${body.name}'s Workspace`, ownerUserId: user.id });
  const token = await signSession(user.id, c.env.AUTH_JWT_SECRET);
  return c.json({ token, user: { id: user.id, name: user.name, email: user.email }, workspace: { id: workspace.id, name: workspace.name } }, 201);
});

auth.post('/login', async (c) => {
  const body = await c.req.json<{ email?: string; password?: string }>();
  if (!body.email || !body.password) return c.json({ error: 'email and password required' }, 400);
  const user = await getUserByEmail(c.env.DB, body.email);
  if (!user || !(await verifyPassword(body.password, user.password_hash))) return c.json({ error: 'invalid credentials' }, 401);
  const token = await signSession(user.id, c.env.AUTH_JWT_SECRET);
  return c.json({ token, user: { id: user.id, name: user.name, email: user.email, avatar_url: user.avatar_url } });
});

auth.post('/forgot-password', async (c) => {
  const body = await c.req.json<{ email?: string }>();
  if (!body.email) return c.json({ error: 'email required' }, 400);
  const user = await getUserByEmail(c.env.DB, body.email);
  if (!user) return c.json({ ok: true });
  const token = await createPasswordResetToken(c.env.DB, user.id);
  return c.json({ ok: true, reset_token: token });
});

auth.post('/reset-password', async (c) => {
  const body = await c.req.json<{ token?: string; password?: string }>();
  if (!body.token || !body.password) return c.json({ error: 'token and password required' }, 400);
  if (body.password.length < 8) return c.json({ error: 'password must be at least 8 characters' }, 400);
  const userId = await consumePasswordResetToken(c.env.DB, body.token);
  if (!userId) return c.json({ error: 'invalid or expired token' }, 400);
  await updateUser(c.env.DB, userId, { passwordHash: await hashPassword(body.password) });
  return c.json({ ok: true });
});

auth.get('/me', requireUser, async (c) => {
  const user = await getUserById(c.env.DB, c.get('userId'));
  if (!user) return c.json({ error: 'not found' }, 404);
  const workspaces = await getWorkspacesForUser(c.env.DB, user.id);
  return c.json({ user: { id: user.id, name: user.name, email: user.email, avatar_url: user.avatar_url }, workspaces: workspaces.map((w) => ({ id: w.id, name: w.name, role: w.role, is_admin: w.is_admin === 1 })) });
});

export default auth;
