import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_AGENT_MODEL,
  getProviderFromModel,
  modelIdWithoutProvider,
  normalizeModelSpecifier,
} from '../src/shared/model-catalog.ts';
import {
  DEFAULT_AGENT_MODEL as UI_DEFAULT_AGENT_MODEL,
  getModelProvider,
  normalizeModelSpecifier as normalizeUiModelSpecifier,
} from '../packages/ui/src/lib/model-catalog.ts';

test('backend and frontend use the same non-preview default agent model', () => {
  assert.equal(DEFAULT_AGENT_MODEL, 'cloudflare/@cf/moonshotai/kimi-k2.6');
  assert.equal(UI_DEFAULT_AGENT_MODEL, DEFAULT_AGENT_MODEL);
});

test('backend model normalization qualifies legacy OpenAI ids', () => {
  assert.equal(normalizeModelSpecifier('gpt-5'), 'openai/gpt-5');
  assert.equal(normalizeModelSpecifier('openrouter/moonshotai/kimi-k2.6'), 'openrouter/moonshotai/kimi-k2.6');
  assert.equal(modelIdWithoutProvider('openai/gpt-5'), 'gpt-5');
});

test('frontend model normalization and provider extraction match backend defaults', () => {
  assert.equal(normalizeUiModelSpecifier('gpt-5'), 'openai/gpt-5');
  assert.equal(getModelProvider(undefined), 'cloudflare');
  assert.equal(getProviderFromModel('cloudflare/@cf/moonshotai/kimi-k2.6'), 'cloudflare');
});
