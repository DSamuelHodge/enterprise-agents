export type ModelProviderId = 'openai' | 'anthropic' | 'openrouter' | 'google' | 'cloudflare' | 'custom';
export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
export type FlueThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

export interface ModelCatalogEntry {
  id: string;
  label: string;
  provider: ModelProviderId;
  supportsReasoning?: boolean;
}

export interface ModelProviderCatalogEntry {
  id: ModelProviderId;
  label: string;
  baseUrl?: string;
  api?: string;
  envVar?: string;
  credentialRequired?: boolean;
  description: string;
  models: ModelCatalogEntry[];
}

export const DEFAULT_AGENT_MODEL = 'cloudflare/@cf/moonshotai/kimi-k2.6';
export const DEFAULT_JUDGE_MODEL = 'cloudflare/@cf/meta/llama-3.1-8b-instruct';

export const MODEL_CATALOG: ModelCatalogEntry[] = [
  { id: 'openai/gpt-5.4', label: 'GPT-5.4', provider: 'openai', supportsReasoning: true },
  { id: 'openai/gpt-5.4-mini', label: 'GPT-5.4 Mini', provider: 'openai', supportsReasoning: true },
  { id: 'openai/gpt-5.4-nano', label: 'GPT-5.4 Nano', provider: 'openai', supportsReasoning: true },
  { id: 'openai/gpt-5.3-chat-latest', label: 'GPT-5.3 Chat', provider: 'openai', supportsReasoning: true },
  { id: 'openai/gpt-5.2', label: 'GPT-5.2', provider: 'openai', supportsReasoning: true },
  { id: 'openai/gpt-5.1', label: 'GPT-5.1', provider: 'openai', supportsReasoning: true },
  { id: 'openai/gpt-5', label: 'GPT-5', provider: 'openai', supportsReasoning: true },
  { id: 'openai/gpt-5-mini', label: 'GPT-5 Mini', provider: 'openai', supportsReasoning: true },
  { id: 'openai/gpt-5-nano', label: 'GPT-5 Nano', provider: 'openai', supportsReasoning: true },
  { id: 'anthropic/claude-sonnet-4-6', label: 'Claude Sonnet 4.6', provider: 'anthropic' },
  { id: 'anthropic/claude-haiku-4-5', label: 'Claude Haiku 4.5', provider: 'anthropic' },
  { id: 'google/gemini-2.5-pro', label: 'Gemini 2.5 Pro', provider: 'google' },
  { id: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash', provider: 'google' },
  { id: 'openrouter/moonshotai/kimi-k2.6', label: 'Kimi K2.6 via OpenRouter', provider: 'openrouter' },
  { id: 'cloudflare/@cf/meta/llama-3.1-8b-instruct', label: 'Llama 3.1 8B via Workers AI', provider: 'cloudflare' },
  { id: 'cloudflare/@cf/mistral/mistral-7b-instruct-v0.1', label: 'Mistral 7B via Workers AI', provider: 'cloudflare' },
  { id: 'cloudflare/@cf/moonshotai/kimi-k2.6', label: 'Kimi K2.6 via Workers AI', provider: 'cloudflare' },
  { id: 'custom/default', label: 'Custom OpenAI-compatible model', provider: 'custom' },
];

export const MODEL_PROVIDER_CATALOG: ModelProviderCatalogEntry[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    api: 'openai-responses',
    envVar: 'OPENAI_API_KEY',
    description: 'OpenAI Responses API models.',
    models: MODEL_CATALOG.filter((model) => model.provider === 'openai'),
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    baseUrl: 'https://api.anthropic.com',
    api: 'anthropic-messages',
    envVar: 'ANTHROPIC_API_KEY',
    description: 'Anthropic Claude Messages API models.',
    models: MODEL_CATALOG.filter((model) => model.provider === 'anthropic'),
  },
  {
    id: 'google',
    label: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    api: 'openai-completions',
    envVar: 'GOOGLE_GENERATIVE_AI_API_KEY',
    description: 'Gemini through the OpenAI-compatible endpoint.',
    models: MODEL_CATALOG.filter((model) => model.provider === 'google'),
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    api: 'openai-completions',
    envVar: 'OPENROUTER_API_KEY',
    description: 'OpenRouter OpenAI-compatible model routing.',
    models: MODEL_CATALOG.filter((model) => model.provider === 'openrouter'),
  },
  {
    id: 'cloudflare',
    label: 'Cloudflare AI Gateway',
    credentialRequired: false,
    description: 'Cloudflare binding-backed models routed through the configured AI Gateway.',
    models: MODEL_CATALOG.filter((model) => model.provider === 'cloudflare'),
  },
  {
    id: 'custom',
    label: 'Custom Provider',
    api: 'openai-completions',
    description: 'User-supplied OpenAI-compatible base URL and API key.',
    models: MODEL_CATALOG.filter((model) => model.provider === 'custom'),
  },
];

const LEGACY_OPENAI_PREFIXES = [/^gpt-/, /^o\d/, /^o\d-/];
const MODEL_SPECIFIER_RE = /^[a-z][a-z0-9-]{0,39}\/[^\s]{1,139}$/i;

export function normalizeModelSpecifier(model: string | null | undefined, fallback = DEFAULT_AGENT_MODEL): string {
  const raw = (model ?? '').trim();
  const candidate = raw || fallback;
  if (candidate.toLowerCase().startsWith('workspace-')) {
    return normalizeModelSpecifier(fallback === candidate ? DEFAULT_AGENT_MODEL : fallback, DEFAULT_AGENT_MODEL);
  }
  const providerQualified = candidate.includes('/')
    ? candidate
    : LEGACY_OPENAI_PREFIXES.some((prefix) => prefix.test(candidate))
      ? `openai/${candidate}`
      : fallback;
  const providerId = providerQualified.split('/')[0] ?? '';
  return !providerId.startsWith('workspace-') && MODEL_SPECIFIER_RE.test(providerQualified) && providerQualified.length <= 180
    ? providerQualified
    : normalizeModelSpecifier(fallback === candidate ? DEFAULT_AGENT_MODEL : fallback, DEFAULT_AGENT_MODEL);
}

export function getProviderFromModel(model: string | null | undefined): ModelProviderId {
  const provider = normalizeModelSpecifier(model).split('/')[0] as ModelProviderId;
  return MODEL_PROVIDER_CATALOG.some((entry) => entry.id === provider) ? provider : 'custom';
}

export function modelIdWithoutProvider(model: string): string {
  const normalized = normalizeModelSpecifier(model);
  return normalized.slice(normalized.indexOf('/') + 1);
}

export function toFlueThinkingLevel(reasoningEffort: ReasoningEffort | null | undefined): FlueThinkingLevel | undefined {
  switch (reasoningEffort) {
    case 'none':
      return 'off';
    case 'minimal':
    case 'low':
    case 'medium':
    case 'high':
    case 'xhigh':
      return reasoningEffort;
    default:
      return undefined;
  }
}

export function normalizeReasoningEffort(value: unknown, fallback: ReasoningEffort = 'medium'): ReasoningEffort {
  if (value === 'off') return 'none';
  if (value === 'none' || value === 'minimal' || value === 'low' || value === 'medium' || value === 'high' || value === 'xhigh') {
    return value;
  }
  return fallback;
}
