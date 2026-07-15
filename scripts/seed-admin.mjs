#!/usr/bin/env node
import { randomBytes, randomUUID, pbkdf2Sync } from 'node:crypto';

const ITERATIONS = 210_000;
function b64url(buf) { return buf.toString('base64').replaceAll('+','-').replaceAll('/','_').replace(/=+$/,''); }

const email = process.env.ADMIN_EMAIL ?? 'admin@example.com';
const name = process.env.ADMIN_NAME ?? 'Admin';
const password = process.env.ADMIN_PASSWORD ?? b64url(randomBytes(18));

const salt = randomBytes(16);
const hash = pbkdf2Sync(password, salt, ITERATIONS, 32, 'sha256');
const stored = `pbkdf2$${ITERATIONS}$${b64url(salt)}$${b64url(hash)}`;

const userId = randomUUID();
const workspaceId = randomUUID();

const sql = `-- admin seed (generated ${new Date().toISOString()})
INSERT INTO users (id, name, email, password_hash) VALUES ('${userId}', '${name.replaceAll("'","''")}', '${email.replaceAll("'","''")}', '${stored}');
INSERT INTO workspaces (id, name, is_admin) VALUES ('${workspaceId}', 'Admin', 1);
INSERT INTO user_workspaces (id, user_id, workspace_id, role) VALUES ('${randomUUID()}', '${userId}', '${workspaceId}', 'owner');
INSERT INTO mcp_servers (id, workspace_id, server_label, server_url, local, server_description) VALUES ('${randomUUID()}', '${workspaceId}', 'OpenAI', NULL, 1, 'Add your OpenAI API key so agents in this workspace can use LLM features. The key is stored encrypted.');
`;

process.stdout.write(sql);
console.error(`\nAdmin credentials — store these now:\n  email:    ${email}\n  password: ${password}\n`);
