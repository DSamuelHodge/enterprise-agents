import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { MODEL_PROVIDER_CATALOG } from '../src/shared/model-catalog.ts';

const repoPath = (path: string) => resolve(import.meta.dirname, '..', path);

test('Cloudflare is a managed AI Gateway provider with no workspace key requirement', () => {
  const provider = MODEL_PROVIDER_CATALOG.find((entry) => entry.id === 'cloudflare');
  assert.ok(provider);
  assert.equal(provider.credentialRequired, false);
  assert.match(provider.description, /AI Gateway/);
  assert.ok(provider.models.some((model) => model.id === 'cloudflare/@cf/moonshotai/kimi-k2.6'));
});

test('provider connections expose safe metadata and use the encrypted token path', () => {
  const api = readFileSync(repoPath('src/api/agents.ts'), 'utf8');
  const routing = readFileSync(repoPath('src/shared/model-routing.ts'), 'utf8');
  const repos = readFileSync(repoPath('src/db/repos/agents.ts'), 'utf8');

  assert.match(api, /credential_configured: true/);
  assert.match(api, /provider_label:/);
  assert.match(routing, /encryptSecret\(input\.apiKey\.trim\(\)/);
  assert.match(routing, /default_model must belong/);
  assert.match(repos, /json_extract\(provider_metadata, '\$\.provider_id'\)/);
  assert.match(api, /access_token.*not returned|access_token/);
});

test('the Worker explicitly registers Cloudflare AI Gateway', () => {
  const app = readFileSync(repoPath('src/app.ts'), 'utf8');
  const wrangler = readFileSync(repoPath('wrangler.jsonc'), 'utf8');

  assert.match(app, /registerProvider\('cloudflare'/);
  assert.match(app, /api: 'cloudflare-ai-binding'/);
  assert.match(app, /AI_GATEWAY_ID/);
  assert.match(wrangler, /"AI_GATEWAY_ID": "default"/);
});

test('production deployment has a pull-request verification workflow', () => {
  const ci = readFileSync(repoPath('.github/workflows/ci.yml'), 'utf8');
  const deploy = readFileSync(repoPath('.github/workflows/deploy-cloudflare.yml'), 'utf8');

  assert.match(ci, /pull_request:/);
  assert.match(ci, /pnpm test/);
  assert.match(ci, /pnpm build:backend/);
  assert.match(ci, /pnpm build:frontend/);
  assert.match(deploy, /pnpm test/);
});
