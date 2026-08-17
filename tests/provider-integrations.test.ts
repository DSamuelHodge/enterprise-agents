import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { MODEL_PROVIDER_CATALOG } from '../src/shared/model-catalog.ts';
import agents from '../src/api/agents.ts';
import { parseDiscoveredModels } from '../src/shared/model-routing.ts';

const repoPath = (path: string) => resolve(import.meta.dirname, '..', path);

function createModelProviderRouteDb(connection: Record<string, unknown>) {
  const server = {
    id: 'server-1', workspace_id: 'workspace-1', server_label: 'OpenAI', server_url: null,
    local: 1, server_description: null, headers: null, require_approval: null,
    created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
  };
  return {
    prepare(sql: string) {
      return {
        bind(..._binds: unknown[]) {
          return {
            async first<T>() {
              if (sql.includes('FROM user_workspaces')) return { user_id: 'user-1', workspace_id: 'workspace-1', role: 'owner' } as T;
              if (sql.includes('FROM mcp_servers')) return server as T;
              return null;
            },
            async all<T>() {
              if (sql.includes('FROM mcp_servers')) return { results: [server] as T[] };
              if (sql.includes('FROM user_oauth_connections')) return { results: [connection] as T[] };
              if (sql.includes('FROM model_provider_models')) throw new Error('no such table: model_provider_models');
              return { results: [] as T[] };
            },
          };
        },
      };
    },
  } as unknown as D1Database;
}

test('Cloudflare is a managed AI Gateway provider with no workspace key requirement', () => {
  const provider = MODEL_PROVIDER_CATALOG.find((entry) => entry.id === 'cloudflare');
  assert.ok(provider);
  assert.equal(provider.credentialRequired, false);
  assert.match(provider.description, /AI Gateway/);
  assert.ok(provider.models.some((model) => model.id === 'cloudflare/@cf/moonshotai/kimi-k2.6'));
});

test('provider connections expose safe metadata and use the encrypted token path', async () => {
  const api = readFileSync(repoPath('src/api/agents.ts'), 'utf8');
  const routing = readFileSync(repoPath('src/shared/model-routing.ts'), 'utf8');
  const repos = readFileSync(repoPath('src/db/repos/agents.ts'), 'utf8');

  assert.match(api, /credential_configured: true/);
  assert.match(api, /provider_label:/);
  assert.match(routing, /encryptSecret\(input\.apiKey\.trim\(\)/);
  assert.match(routing, /default_model must belong/);
  assert.match(repos, /provider_identity/);
  assert.match(repos, /ON CONFLICT\(workspace_id, provider_identity\)/);
  const rows = [
    {
      id: 'connection-1', user_id: 'user-1', workspace_id: 'workspace-1', mcp_server_id: 'server-1',
      auth_type: 'bearer' as const, access_token: 'encrypted-secret', refresh_token: null,
      token_type: 'Bearer', token_name: 'Production', expires_at: null, scope: null,
      resource_server: null, audience: null, is_default: 1, provider_metadata: JSON.stringify({
        kind: 'model_provider', provider_id: 'openai', default_model: 'openai/gpt-5.4',
      }), connected_at: '2026-01-01T00:00:00.000Z', last_refreshed_at: null,
      created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z', provider_identity: 'openai',
    },
  ];
  const response = await agents.request('/workspaces/workspace-1/model-providers', {}, {
    DB: createModelProviderRouteDb(rows[0]),
  } as never);
  assert.equal(response.status, 200);
  const body = await response.json() as { connections: Array<Record<string, unknown>> };
  for (const connection of body.connections) {
    assert.equal(Object.prototype.hasOwnProperty.call(connection, 'access_token'), false);
  }
  assert.match(api, /connections: connections\.map\(serializeModelProviderConnection\)/);
});

test('the Worker explicitly registers Cloudflare AI Gateway', () => {
  const app = readFileSync(repoPath('src/app.ts'), 'utf8');
  const wrangler = readFileSync(repoPath('wrangler.jsonc'), 'utf8');

  assert.match(app, /registerProvider\('cloudflare'/);
  assert.match(app, /api: 'cloudflare-ai-binding'/);
  assert.match(app, /AI_GATEWAY_ID/);
  assert.match(wrangler, /"AI_GATEWAY_ID": "default"/);
});

test('provider model discovery accepts provider-native model lists', () => {
  assert.deepEqual(
    parseDiscoveredModels('openai', { data: [{ id: 'future-model' }, { id: 'future-model' }] }),
    [{ modelId: 'openai/future-model', label: 'future-model', metadata: { id: 'future-model' } }],
  );
  assert.deepEqual(
    parseDiscoveredModels('google', { models: [{ name: 'models/gemini-custom', displayName: 'Gemini Custom', baseModelId: 'gemini-custom' }] }),
    [{ modelId: 'google/gemini-custom', label: 'Gemini Custom', metadata: { name: 'models/gemini-custom', displayName: 'Gemini Custom', baseModelId: 'gemini-custom' } }],
  );
});

test('production deployment has a pull-request verification workflow', () => {
  const ci = readFileSync(repoPath('.github/workflows/ci.yml'), 'utf8');
  const deploy = readFileSync(repoPath('.github/workflows/deploy-cloudflare.yml'), 'utf8');
  const migration = readFileSync(repoPath('migrations/0005_provider_identity_and_model_cache.sql'), 'utf8');

  assert.match(ci, /pull_request:/);
  assert.match(ci, /persist-credentials: false/);
  assert.match(ci, /pnpm test/);
  assert.match(ci, /pnpm build:backend/);
  assert.match(ci, /pnpm build:frontend/);
  assert.match(deploy, /pnpm test/);
  assert.match(deploy, /pnpm db:migrate/);
  assert.match(migration, /provider_identity TEXT/);
  assert.match(migration, /ux_uoc_workspace_provider_identity/);
  assert.match(migration, /row_number\(\)/);
});
