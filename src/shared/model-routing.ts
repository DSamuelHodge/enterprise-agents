import { json } from '../db/client.ts';
import { createMcpServer, listMcpServers, listModelProviderModels, listOauthConnections, replaceModelProviderModels, upsertOauthToken } from '../db/repos/agents.ts';
import type { UserOauthConnectionRow } from '../db/types.ts';
import type { Env } from '../env.d.ts';
import { decryptSecret, encryptSecret } from './crypto.ts';
import {
  MODEL_PROVIDER_CATALOG,
  getProviderFromModel,
  modelIdWithoutProvider,
  normalizeModelSpecifier,
  toFlueThinkingLevel,
  type ReasoningEffort,
  type ModelProviderId,
} from './model-catalog.ts';

export { normalizeModelSpecifier };

export interface ModelProviderStatus {
  provider_id: ModelProviderId;
  label: string;
  description: string;
  credential_required: boolean;
  configured: boolean;
  credential_configured: boolean;
  env_configured: boolean;
  server_id: string | null;
  base_url: string | null;
  models: { value: string; label: string }[];
  models_fetched_at: string | null;
}

export interface ModelProviderCredentialInput {
  userId: string;
  workspaceId: string;
  providerId: ModelProviderId;
  apiKey: string;
  tokenName?: string | null;
  baseUrl?: string | null;
  api?: string | null;
  customProviderId?: string | null;
  defaultModel?: string | null;
}

export function normalizeOptionalModelSpecifier(model: unknown, fallback?: string): string | undefined {
  if (typeof model !== 'string' || !model.trim()) return undefined;
  const normalized = normalizeModelSpecifier(model, fallback);
  if (normalized.toLowerCase().startsWith('workspace-')) {
    throw new Error('internal workspace model provider ids are not selectable');
  }
  return normalized;
}

export function normalizeReasoningEffort(value: unknown, fallback: ReasoningEffort = 'medium'): ReasoningEffort {
  if (value === 'off') return 'none';
  if (value === 'none' || value === 'minimal' || value === 'low' || value === 'medium' || value === 'high' || value === 'xhigh') {
    return value;
  }
  return fallback;
}

export function toThinkingLevel(value: unknown) {
  return toFlueThinkingLevel(normalizeReasoningEffort(value));
}

type ProviderMetadata = {
  kind?: string;
  provider_id?: string;
  custom_provider_id?: string;
  base_url?: string;
  api?: string;
  default_model?: string;
  provider_identity?: string;
};

const PROVIDER_LABELS: Record<ModelProviderId, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google Gemini',
  openrouter: 'OpenRouter',
  cloudflare: 'Cloudflare AI Gateway',
  custom: 'Custom Model Provider',
};

function envKeyConfigured(env: Env, envVar?: string): boolean {
  if (!envVar) return false;
  return Boolean((env as unknown as Record<string, string | undefined>)[envVar]);
}

function parseMetadata(row: UserOauthConnectionRow): ProviderMetadata {
  return json<ProviderMetadata>(row.provider_metadata, {});
}

function isConnectionForProvider(row: UserOauthConnectionRow, providerId: ModelProviderId, serverLabel?: string): boolean {
  const metadata = parseMetadata(row);
  if (metadata.kind === 'model_provider' && metadata.provider_id === providerId) return true;
  return providerId === 'openai' && serverLabel?.toLowerCase() === 'openai';
}

export async function ensureModelProviderServer(
  db: D1Database,
  workspaceId: string,
  providerId: ModelProviderId,
) {
  const label = PROVIDER_LABELS[providerId] ?? providerId;
  const servers = await listMcpServers(db, workspaceId);
  const existing = servers.find((server) => server.server_label.toLowerCase() === label.toLowerCase())
    ?? (providerId === 'openai' ? servers.find((server) => server.server_label.toLowerCase() === 'openai') : null);
  if (existing) return existing;
  return createMcpServer(db, {
    workspaceId,
    serverLabel: label,
    local: true,
    serverDescription: `${label} model provider credentials`,
  });
}

export async function listModelProviderStatuses(env: Env, workspaceId: string): Promise<ModelProviderStatus[]> {
  const [servers, connections] = await Promise.all([
    listMcpServers(env.DB, workspaceId),
    listOauthConnections(env.DB, workspaceId),
  ]);
  let cachedModels: Awaited<ReturnType<typeof listModelProviderModels>> = [];
  try {
    cachedModels = await listModelProviderModels(env.DB, workspaceId);
  } catch (error) {
    // Keep provider selection available while an older deployment catches up
    // with the provider-model cache migration.
    console.error('Unable to read cached model-provider models', error);
  }
  const serverLabelById = new Map(servers.map((server) => [server.id, server.server_label]));
  return MODEL_PROVIDER_CATALOG.map((provider) => {
    const label = PROVIDER_LABELS[provider.id];
    const server = servers.find((entry) => entry.server_label.toLowerCase() === label.toLowerCase())
      ?? (provider.id === 'openai' ? servers.find((entry) => entry.server_label.toLowerCase() === 'openai') : null);
    const credentialConfigured = connections.some((connection) =>
      isConnectionForProvider(connection, provider.id, serverLabelById.get(connection.mcp_server_id))
    );
    const envConfigured = provider.id === 'cloudflare' || envKeyConfigured(env, provider.envVar);
    const providerCachedModels = cachedModels.filter((model) => model.provider_id === provider.id);
    const catalogModels = provider.models.map((model) => ({ value: model.id, label: model.label }));
    const models = providerCachedModels.length > 0
      ? providerCachedModels.map((model) => ({ value: model.model_id, label: model.label }))
      : catalogModels;
    return {
      provider_id: provider.id,
      label: provider.label,
      description: provider.description,
      credential_required: provider.credentialRequired !== false,
      configured: credentialConfigured || envConfigured,
      credential_configured: credentialConfigured,
      env_configured: envConfigured,
      server_id: server?.id ?? null,
      base_url: provider.baseUrl ?? null,
      models,
      models_fetched_at: providerCachedModels[0]?.fetched_at ?? null,
    };
  });
}

type DiscoveredModel = {
  modelId: string;
  label: string;
  metadata?: Record<string, unknown>;
};

function modelListRequest(providerId: ModelProviderId, baseUrl: string, apiKey: string) {
  const headers: Record<string, string> = { accept: 'application/json' };
  let url = `${baseUrl.replace(/\/$/, '')}/models`;
  if (providerId === 'anthropic') {
    const normalizedBaseUrl = baseUrl.replace(/\/$/, '');
    url = `${normalizedBaseUrl.endsWith('/v1') ? normalizedBaseUrl : `${normalizedBaseUrl}/v1`}/models`;
    headers['x-api-key'] = apiKey;
    headers['anthropic-version'] = '2023-06-01';
  } else if (providerId === 'google') {
    url = 'https://generativelanguage.googleapis.com/v1beta/models';
    headers['x-goog-api-key'] = apiKey;
  } else {
    headers.authorization = `Bearer ${apiKey}`;
  }
  return { url, headers };
}

function normalizeDiscoveredModelId(providerId: ModelProviderId, modelId: string) {
  const normalized = modelId.trim().replace(/^models\//, '');
  return normalized.startsWith(`${providerId}/`) ? normalized : `${providerId}/${normalized}`;
}

export function parseDiscoveredModels(providerId: ModelProviderId, payload: unknown): DiscoveredModel[] {
  const body = payload as { data?: unknown; models?: unknown };
  const entries = Array.isArray(body?.data)
    ? body.data
    : Array.isArray(body?.models)
      ? body.models
      : [];
  const seen = new Set<string>();
  const models: DiscoveredModel[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const item = entry as Record<string, unknown>;
    const rawId = providerId === 'google'
      ? item.baseModelId ?? item.name
      : item.id ?? item.name;
    if (typeof rawId !== 'string' || !rawId.trim()) continue;
    const modelId = normalizeDiscoveredModelId(providerId, rawId);
    if (seen.has(modelId)) continue;
    seen.add(modelId);
    models.push({
      modelId,
      label: String(item.display_name ?? item.displayName ?? item.id ?? rawId),
      metadata: item,
    });
  }
  return models;
}

export async function refreshModelProviderModels(env: Env, workspaceId: string, providerId: ModelProviderId) {
  if (providerId === 'cloudflare') return [];
  const token = await findProviderToken(env.DB, workspaceId, providerId);
  if (!token) throw new Error(`no saved credentials for ${providerId}`);
  const metadata = parseMetadata(token);
  const catalogEntry = MODEL_PROVIDER_CATALOG.find((provider) => provider.id === providerId);
  const baseUrl = metadata.base_url || catalogEntry?.baseUrl;
  if (!baseUrl) throw new Error(`no model-list URL configured for ${providerId}`);
  const { url, headers } = modelListRequest(
    providerId,
    baseUrl,
    await decryptSecret(token.access_token, env.TOKEN_ENCRYPTION_KEY),
  );
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`${providerId} model discovery failed (${response.status})`);
  const models = parseDiscoveredModels(providerId, await response.json());
  await replaceModelProviderModels(env.DB, workspaceId, providerId, models);
  return models;
}

export async function upsertModelProviderCredential(env: Env, input: ModelProviderCredentialInput) {
  const catalogEntry = MODEL_PROVIDER_CATALOG.find((provider) => provider.id === input.providerId);
  if (!catalogEntry) throw new Error(`unsupported model provider: ${input.providerId}`);
  if (catalogEntry.credentialRequired === false) throw new Error(`${catalogEntry.label} uses the Worker binding and does not accept a workspace API key`);
  if (!input.apiKey.trim()) throw new Error('api_key is required');
  const baseUrl = input.baseUrl?.trim() || catalogEntry.baseUrl;
  if (input.providerId === 'custom' && !baseUrl) throw new Error('base_url is required for custom providers');
  const api = input.api?.trim() || catalogEntry.api;
  if (input.providerId === 'custom' && !api) throw new Error('api is required for custom providers');
  let defaultModel = input.defaultModel?.trim() || undefined;
  if (defaultModel) {
    defaultModel = normalizeModelSpecifier(defaultModel, catalogEntry.models[0]?.id);
    if (getProviderFromModel(defaultModel) !== input.providerId) {
      throw new Error(`default_model must belong to the ${catalogEntry.label} provider`);
    }
  }
  const server = await ensureModelProviderServer(env.DB, input.workspaceId, input.providerId);
  const providerIdentity = input.providerId;
  const token = await upsertOauthToken(env.DB, {
    userId: input.userId,
    workspaceId: input.workspaceId,
    mcpServerId: server.id,
    authType: 'bearer',
    accessTokenEnc: await encryptSecret(input.apiKey.trim(), env.TOKEN_ENCRYPTION_KEY),
    tokenType: 'Bearer',
    tokenName: input.tokenName ?? `${catalogEntry.label} API key`,
    providerMetadata: {
      kind: 'model_provider',
      provider_id: input.providerId,
      provider_identity: providerIdentity,
      custom_provider_id: input.customProviderId?.trim() || undefined,
      base_url: baseUrl,
      api,
      default_model: defaultModel,
    },
    providerIdentity,
    isDefault: true,
  });
  try {
    await refreshModelProviderModels(env, input.workspaceId, input.providerId);
  } catch {
    // Credentials remain usable when a provider temporarily rejects discovery.
  }
  return {
    id: token.id,
    provider_id: input.providerId,
    server_id: server.id,
    token_name: token.token_name,
  };
}

async function findProviderToken(db: D1Database, workspaceId: string, providerId: ModelProviderId) {
  const [servers, connections] = await Promise.all([
    listMcpServers(db, workspaceId),
    listOauthConnections(db, workspaceId),
  ]);
  const serverLabelById = new Map(servers.map((server) => [server.id, server.server_label]));
  return connections
    .filter((connection) => isConnectionForProvider(connection, providerId, serverLabelById.get(connection.mcp_server_id)))
    .sort((a, b) => (b.is_default - a.is_default) || b.created_at.localeCompare(a.created_at))[0] ?? null;
}

function workspaceProviderId(workspaceId: string, providerId: ModelProviderId): string {
  const compactWorkspaceId = workspaceId.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 16) || 'workspace';
  return `w-${compactWorkspaceId}-${providerId}`;
}

export async function resolveWorkspaceModelSpecifier(
  env: Env,
  workspaceId: string,
  model: string | null | undefined,
  fallback = env.DEFAULT_MODEL,
): Promise<string> {
  const normalized = normalizeModelSpecifier(model, fallback);
  if (normalized.toLowerCase().startsWith('workspace-') || normalized.toLowerCase().startsWith('w-')) {
    throw new Error('internal workspace model provider ids are not selectable');
  }
  const providerId = getProviderFromModel(normalized);
  if (providerId === 'cloudflare') return normalized;

  const token = await findProviderToken(env.DB, workspaceId, providerId);
  if (!token) return normalized;

  const metadata = parseMetadata(token);
  const catalogEntry = MODEL_PROVIDER_CATALOG.find((provider) => provider.id === providerId);
  const baseUrl = metadata.base_url || catalogEntry?.baseUrl;
  const api = metadata.api || catalogEntry?.api;
  if (!baseUrl || !api) return normalized;

  const namespacedProviderId = workspaceProviderId(workspaceId, providerId);
  const { registerProvider } = await import('@flue/runtime');
  registerProvider(namespacedProviderId, {
    api: api as never,
    baseUrl,
    apiKey: await decryptSecret(token.access_token, env.TOKEN_ENCRYPTION_KEY),
  });
  return `${namespacedProviderId}/${modelIdWithoutProvider(normalized)}`;
}

export async function resolveWorkspacePromptOptions(
  env: Env,
  workspaceId: string,
  model: string | null | undefined,
  fallback = env.DEFAULT_MODEL,
  reasoningEffort?: unknown,
) {
  return {
    model: await resolveWorkspaceModelSpecifier(env, workspaceId, model, fallback),
    thinkingLevel: toThinkingLevel(reasoningEffort),
  };
}
