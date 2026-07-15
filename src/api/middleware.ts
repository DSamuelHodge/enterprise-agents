import type { Context, MiddlewareHandler } from 'hono';
import type { Env } from '../env.d.ts';
import { verifySession } from '../shared/crypto.ts';
import { getMembership } from '../db/repos/identity.ts';

export type ApiEnv = {
  Bindings: Env;
  Variables: { userId: string };
};

export const requireUser: MiddlewareHandler<ApiEnv> = async (c, next) => {
  const auth = c.req.header('Authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return c.json({ error: 'unauthorized' }, 401);
  const claims = await verifySession(token, c.env.AUTH_JWT_SECRET);
  if (!claims) return c.json({ error: 'unauthorized' }, 401);
  c.set('userId', claims.sub);
  await next();
};

export async function assertMembership(
  c: Context<ApiEnv>,
  workspaceId: string,
  roles?: Array<'owner' | 'admin' | 'member'>,
): Promise<Response | null> {
  const membership = await getMembership(c.env.DB, c.get('userId'), workspaceId);
  if (!membership) return c.json({ error: 'not a member of this workspace' }, 403);
  if (roles && !roles.includes(membership.role)) return c.json({ error: `requires role: ${roles.join(' or ')}` }, 403);
  return null;
}

export function badRequest(c: Context<ApiEnv>, message: string) {
  return c.json({ error: message }, 400);
}
