export type ModelProviderId =
  | "openai"
  | "anthropic"
  | "google"
  | "openrouter"
  | "cloudflare"
  | "cloudflare-workers-ai"
  | "cloudflare-ai-gateway"
  | "custom";

export interface ModelCatalogEntry {
  id: string;
  provider: ModelProviderId;
  label: string;
  supportsReasoning: boolean;
  recommendedFor: "agent" | "judge" | "both";
}

export const DEFAULT_AGENT_MODEL = "openai/gpt-5";
export const DEFAULT_JUDGE_MODEL = "openai/gpt-5-nano";

export const MODEL_PROVIDER_LABELS: Record<ModelProviderId, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google Gemini",
  openrouter: "OpenRouter",
  cloudflare: "Cloudflare Workers AI",
  "cloudflare-workers-ai": "Cloudflare Workers AI API",
  "cloudflare-ai-gateway": "Cloudflare AI Gateway",
  custom: "Custom",
};

export const MODEL_CATALOG: ModelCatalogEntry[] = [
  { id: "openai/gpt-5.4", provider: "openai", label: "GPT-5.4", supportsReasoning: true, recommendedFor: "both" },
  { id: "openai/gpt-5.4-mini", provider: "openai", label: "GPT-5.4 Mini", supportsReasoning: true, recommendedFor: "both" },
  { id: "openai/gpt-5.4-nano", provider: "openai", label: "GPT-5.4 Nano", supportsReasoning: true, recommendedFor: "judge" },
  { id: "openai/gpt-5", provider: "openai", label: "GPT-5", supportsReasoning: true, recommendedFor: "both" },
  { id: "openai/gpt-5-mini", provider: "openai", label: "GPT-5 Mini", supportsReasoning: true, recommendedFor: "both" },
  { id: "openai/gpt-5-nano", provider: "openai", label: "GPT-5 Nano", supportsReasoning: true, recommendedFor: "judge" },
  { id: "anthropic/claude-sonnet-4-6", provider: "anthropic", label: "Claude Sonnet 4.6", supportsReasoning: true, recommendedFor: "both" },
  { id: "anthropic/claude-haiku-4-5", provider: "anthropic", label: "Claude Haiku 4.5", supportsReasoning: true, recommendedFor: "both" },
  { id: "google/gemini-2.5-pro", provider: "google", label: "Gemini 2.5 Pro", supportsReasoning: false, recommendedFor: "both" },
  { id: "google/gemini-2.5-flash", provider: "google", label: "Gemini 2.5 Flash", supportsReasoning: false, recommendedFor: "both" },
  { id: "openrouter/moonshotai/kimi-k2.6", provider: "openrouter", label: "Kimi K2.6 via OpenRouter", supportsReasoning: false, recommendedFor: "both" },
  { id: "cloudflare/@cf/meta/llama-3.1-8b-instruct", provider: "cloudflare", label: "Llama 3.1 8B via Workers AI", supportsReasoning: false, recommendedFor: "agent" },
  { id: "cloudflare/@cf/mistral/mistral-7b-instruct-v0.1", provider: "cloudflare", label: "Mistral 7B via Workers AI", supportsReasoning: false, recommendedFor: "agent" },
  { id: "custom/default", provider: "custom", label: "Custom default model", supportsReasoning: false, recommendedFor: "both" },
];

export const REASONING_EFFORT_OPTIONS = [
  { value: "none", label: "None" },
  { value: "minimal", label: "Minimal" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "Extra High" },
];

export function normalizeModelSpecifier(model: string | null | undefined) {
  const value = (model || DEFAULT_AGENT_MODEL).trim();
  return /^(gpt-|o\d|chatgpt-|text-|dall-e|whisper)/.test(value)
    ? `openai/${value}`
    : value;
}

export const MODEL_OPTIONS = modelOptionsFor("agent");

export function normalizeUiModel(model: string | null | undefined, fallback = DEFAULT_AGENT_MODEL) {
  return normalizeModelSpecifier(model || fallback);
}

export function getModelProvider(model: string | null | undefined): ModelProviderId {
  const provider = normalizeModelSpecifier(model).split("/")[0] as ModelProviderId;
  return provider || "openai";
}

export function getModelLabel(model: string | null | undefined) {
  const normalized = normalizeModelSpecifier(model);
  return MODEL_CATALOG.find((entry) => entry.id === normalized)?.label ?? normalized;
}

export function modelOptionsFor(kind: "agent" | "judge" = "agent") {
  return MODEL_CATALOG.filter(
    (entry) => entry.recommendedFor === "both" || entry.recommendedFor === kind,
  ).map((entry) => ({
    value: entry.id,
    label: `${MODEL_PROVIDER_LABELS[entry.provider]} / ${entry.label}`,
  }));
}
