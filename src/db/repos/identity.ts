/**
 * Identity domain: users, workspaces, user_workspaces, teams, invites,
 * password reset tokens.
 * Ports: functions/users_crud.py, workspaces_crud.py, user_workspaces_crud.py,
 * teams_crud.py, workspace_invites_crud.py, auth_crud.py (data access half).
 */
import { many, one, run } from '../client.ts';
import { nowIso, randomToken, uuid } from '../../shared/crypto.ts';
import type {
  TeamRow,
  UserRow,
  UserWorkspaceRow,
  WorkspaceInviteRow,
  WorkspaceRow,
} from '../types.ts';

// ── users ───────────────────────────────────────────────────────────────────

export async function createUser(
  db: D1Database,
  input: { name: string; email: string; passwordHash: string; avatarUrl?: string | null },
): Promise<UserRow> {
  const id = uuid();
  await run(
    db,
    `INSERT INTO users (id, name, email, password_hash, avatar_url) VALUES (?,?,?,?,?)`,
    id, input.name, input.email.toLowerCase(), input.passwordHash, input.avatarUrl ?? null,
  );
  return (await getUserById(db, id))!;
}

export function getUserById(db: D1Database, id: string) {
  return one<UserRow>(db, `SELECT * FROM users WHERE id = ?`, id);
}

export function getUserByEmail(db: D1Database, email: string) {
  return one<UserRow>(db, `SELECT * FROM users WHERE email = ? COLLATE NOCASE`, email);
}

export function getUsersByWorkspace(db: D1Database, workspaceId: string) {
  return many<UserRow & { role: string }>(
    db,
    `SELECT u.*, uw.role FROM users u
     JOIN user_workspaces uw ON uw.user_id = u.id
     WHERE uw.workspace_id = ? ORDER BY u.created_at`,
    workspaceId,
  );
}

export async function updateUser(
  db: D1Database,
  id: string,
  patch: { name?: string; avatarUrl?: string | null; passwordHash?: string },
): Promise<UserRow | null> {
  await run(
    db,
    `UPDATE users SET
       name = COALESCE(?, name),
       avatar_url = COALESCE(?, avatar_url),
       password_hash = COALESCE(?, password_hash),
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
     WHERE id = ?`,
    patch.name ?? null, patch.avatarUrl ?? null, patch.passwordHash ?? null, id,
  );
  return getUserById(db, id);
}

export async function deleteUser(db: D1Database, id: string): Promise<boolean> {
  const res = await run(db, `DELETE FROM users WHERE id = ?`, id);
  return res.meta.changes > 0;
}

// ── password reset (auth_crud.py: request_password_reset / reset_password) ──

export async function createPasswordResetToken(db: D1Database, userId: string, ttlMinutes = 30): Promise<string> {
  const token = randomToken(32);
  const expires = new Date(Date.now() + ttlMinutes * 60_000).toISOString();
  await run(
    db,
    `INSERT INTO password_reset_tokens (id, user_id, token, expires_at) VALUES (?,?,?,?)`,
    uuid(), userId, token, expires,
  );
  return token;
}

export async function consumePasswordResetToken(db: D1Database, token: string): Promise<string | null> {
  const row = await one<{ id: string; user_id: string; expires_at: string }>(
    db, `SELECT id, user_id, expires_at FROM password_reset_tokens WHERE token = ?`, token,
  );
  if (!row) return null;
  await run(db, `DELETE FROM password_reset_tokens WHERE id = ?`, row.id); // single-use
  if (row.expires_at < nowIso()) return null;
  return row.user_id;
}

// ── workspaces ──────────────────────────────────────────────────────────────

export async function createWorkspace(
  db: D1Database,
  input: { name: string; ownerUserId: string; isAdmin?: boolean },
): Promise<WorkspaceRow> {
  const id = uuid();
  await db.batch([
    db.prepare(`INSERT INTO workspaces (id, name, is_admin) VALUES (?,?,?)`)
      .bind(id, input.name, input.isAdmin ? 1 : 0),
    db.prepare(`INSERT INTO user_workspaces (id, user_id, workspace_id, role) VALUES (?,?,?,?)`)
      .bind(uuid(), input.ownerUserId, id, 'owner'),
    // Every workspace gets a local "OpenAI" MCP server row for the workspace
    // LLM key (migration 009 behavior).
    db.prepare(
      `INSERT INTO mcp_servers (id, workspace_id, server_label, server_url, local, server_description)
       VALUES (?,?,?,NULL,1,?)`,
    ).bind(
      uuid(), id, 'OpenAI',
      'Add your OpenAI API key so agents in this workspace can use LLM features. The key is stored encrypted.',
    ),
  ]);
  return (await one<WorkspaceRow>(db, `SELECT * FROM workspaces WHERE id = ?`, id))!;
}

export function getWorkspaceById(db: D1Database, id: string) {
  return one<WorkspaceRow>(db, `SELECT * FROM workspaces WHERE id = ?`, id);
}

export function getWorkspacesForUser(db: D1Database, userId: string) {
  return many<WorkspaceRow & { role: string }>(
    db,
    `SELECT w.*, uw.role FROM workspaces w
     JOIN user_workspaces uw ON uw.workspace_id = w.id
     WHERE uw.user_id = ? ORDER BY w.created_at`,
    userId,
  );
}

export async function updateWorkspace(db: D1Database, id: string, name: string) {
  await run(
    db,
    `UPDATE workspaces SET name = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
    name, id,
  );
  return getWorkspaceById(db, id);
}

export async function deleteWorkspace(db: D1Database, id: string): Promise<boolean> {
  const res = await run(db, `DELETE FROM workspaces WHERE id = ?`, id);
  return res.meta.changes > 0;
}

export function getMembership(db: D1Database, userId: string, workspaceId: string) {
  return one<UserWorkspaceRow>(
    db, `SELECT * FROM user_workspaces WHERE user_id = ? AND workspace_id = ?`, userId, workspaceId,
  );
}

export async function upsertMembership(
  db: D1Database,
  input: { userId: string; workspaceId: string; role: 'owner' | 'admin' | 'member' },
) {
  await run(
    db,
    `INSERT INTO user_workspaces (id, user_id, workspace_id, role) VALUES (?,?,?,?)
     ON CONFLICT(user_id, workspace_id) DO UPDATE SET role = excluded.role`,
    uuid(), input.userId, input.workspaceId, input.role,
  );
  return getMembership(db, input.userId, input.workspaceId);
}

export async function removeMembership(db: D1Database, userId: string, workspaceId: string) {
  const res = await run(
    db, `DELETE FROM user_workspaces WHERE user_id = ? AND workspace_id = ?`, userId, workspaceId,
  );
  return res.meta.changes > 0;
}

// ── teams ───────────────────────────────────────────────────────────────────

export async function createTeam(
  db: D1Database,
  input: { workspaceId: string; name: string; description?: string | null; icon?: string | null },
): Promise<TeamRow> {
  const id = uuid();
  await run(
    db,
    `INSERT INTO teams (id, workspace_id, name, description, icon) VALUES (?,?,?,?,?)`,
    id, input.workspaceId, input.name, input.description ?? null, input.icon ?? 'Building',
  );
  return (await one<TeamRow>(db, `SELECT * FROM teams WHERE id = ?`, id))!;
}

export function getTeamsByWorkspace(db: D1Database, workspaceId: string) {
  return many<TeamRow>(db, `SELECT * FROM teams WHERE workspace_id = ? ORDER BY created_at`, workspaceId);
}

export function getTeamById(db: D1Database, id: string) {
  return one<TeamRow>(db, `SELECT * FROM teams WHERE id = ?`, id);
}

export async function updateTeam(
  db: D1Database,
  id: string,
  patch: { name?: string; description?: string | null; icon?: string | null },
) {
  await run(
    db,
    `UPDATE teams SET
       name = COALESCE(?, name),
       description = COALESCE(?, description),
       icon = COALESCE(?, icon),
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
     WHERE id = ?`,
    patch.name ?? null, patch.description ?? null, patch.icon ?? null, id,
  );
  return getTeamById(db, id);
}

export async function deleteTeam(db: D1Database, id: string) {
  const res = await run(db, `DELETE FROM teams WHERE id = ?`, id);
  return res.meta.changes > 0;
}

// ── workspace invites ───────────────────────────────────────────────────────

export async function createInvite(
  db: D1Database,
  input: { workspaceId: string; email: string; role: 'owner' | 'admin' | 'member'; invitedBy: string },
): Promise<WorkspaceInviteRow> {
  // Regenerate flow: revoke any pending invite for the same (workspace, email).
  await run(
    db,
    `UPDATE workspace_invites SET status = 'revoked', revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
     WHERE workspace_id = ? AND invited_email = ? AND status = 'pending'`,
    input.workspaceId, input.email.toLowerCase(),
  );
  const id = uuid();
  const token = randomToken(48);
  await run(
    db,
    `INSERT INTO workspace_invites (id, workspace_id, invited_email, invited_by_user_id, role, token)
     VALUES (?,?,?,?,?,?)`,
    id, input.workspaceId, input.email.toLowerCase(), input.invitedBy, input.role, token,
  );
  return (await one<WorkspaceInviteRow>(db, `SELECT * FROM workspace_invites WHERE id = ?`, id))!;
}

export function getInviteByToken(db: D1Database, token: string) {
  return one<WorkspaceInviteRow>(db, `SELECT * FROM workspace_invites WHERE token = ?`, token);
}

export function listPendingInvites(db: D1Database, workspaceId: string) {
  return many<WorkspaceInviteRow>(
    db,
    `SELECT * FROM workspace_invites WHERE workspace_id = ? AND status = 'pending' ORDER BY created_at DESC`,
    workspaceId,
  );
}

export async function acceptInvite(db: D1Database, token: string, userId: string): Promise<WorkspaceInviteRow | null> {
  const invite = await getInviteByToken(db, token);
  if (!invite || invite.status !== 'pending') return null;
  await db.batch([
    db.prepare(
      `UPDATE workspace_invites SET status = 'accepted',
         accepted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), accepted_by_user_id = ?
       WHERE id = ?`,
    ).bind(userId, invite.id),
    db.prepare(
      `INSERT INTO user_workspaces (id, user_id, workspace_id, role) VALUES (?,?,?,?)
       ON CONFLICT(user_id, workspace_id) DO UPDATE SET role = excluded.role`,
    ).bind(uuid(), userId, invite.workspace_id, invite.role),
  ]);
  return getInviteByToken(db, token);
}

export async function declineInvite(db: D1Database, token: string) {
  await run(
    db,
    `UPDATE workspace_invites SET status = 'declined', declined_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
     WHERE token = ? AND status = 'pending'`,
    token,
  );
  return getInviteByToken(db, token);
}

export async function revokeInvite(db: D1Database, id: string) {
  const res = await run(
    db,
    `UPDATE workspace_invites SET status = 'revoked', revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
     WHERE id = ? AND status = 'pending'`,
    id,
  );
  return res.meta.changes > 0;
}
