/**
 * Application-owned Cloudflare bindings.
 * Flue merges its generated FLUE_* bindings on top of these at build time.
 */
export interface Env {
  // Core relational data (replaces PostgreSQL)
  DB: D1Database;

  // Analytics Engine datasets (replace ClickHouse tables)
  TASK_METRICS: AnalyticsEngineDataset;
  TASK_TRACES: AnalyticsEngineDataset;
  PIPELINE_EVENTS: AnalyticsEngineDataset;

  // Semantic search over dataset events (replaces ClickHouse embedding column)
  VECTORIZE: VectorizeIndex;

  // Dataset source files
  FILES: R2Bucket;

  // Workers AI (embeddings for dataset ingestion)
  AI: Ai;

  // Vars
  DEFAULT_MODEL: string;
  AI_GATEWAY_ID?: string;
  FRONTEND_URL: string;

  // Secrets
  AUTH_JWT_SECRET: string;
  CF_ACCOUNT_ID: string;
  CF_ANALYTICS_TOKEN: string;
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  GOOGLE_GENERATIVE_AI_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  SLACK_SIGNING_SECRET?: string;
  SLACK_CLIENT_ID?: string;
  SLACK_CLIENT_SECRET?: string;
  TOKEN_ENCRYPTION_KEY: string;
}

// `cloudflare:workers` exposes the platform `Cloudflare.Env` type. Keep the
// application-owned binding additions visible there for module-level setup.
declare global {
  namespace Cloudflare {
    interface Env {
      AI: Ai;
      AI_GATEWAY_ID?: string;
    }
  }
}
