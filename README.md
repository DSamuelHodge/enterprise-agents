# boilerplate-backend-flue

The restackio/boilerplate backend re-implemented in TypeScript on **Flue** + **Cloudflare**. Replaces `apps/backend`, `apps/mcp_server`, `apps/webhook`, `apps/slack-bot`, and the PostgreSQL / ClickHouse / CockroachDB / Restack-engine / Kubernetes infrastructure.

## What maps to what

| Original | Here |
|---|---|
| `agents/agent_task.py` (Temporal agent loop) | `src/agents/task.ts` (Flue agent; instance id = task id) |
| ~40 `workflows/crud/*` Temporal workflows | Hono routes in `src/api/*` over D1 repos in `src/db/repos/*` |
| `task_metrics.py` / `retroactive_metrics.py` | `src/workflows/evaluate-metric.ts`, `src/workflows/retroactive-metrics.ts` |
| `embed_anything_ingestion.py` + embed worker | `src/workflows/dataset-ingest.ts` (Workers AI → Vectorize) |
| Restack schedules | D1 `schedule_spec` + cron scanner in `src/cloudflare.ts` → `src/workflows/scheduled-task.ts` |
| PostgreSQL (21 migrations) | D1: `migrations/0001_initial.sql` |
| ClickHouse (`task_metrics`, `task_traces`, `pipeline_events`) | Workers Analytics Engine (`src/analytics/engine.ts`) |
| ClickHouse `embedding Array(Float32)` | Vectorize index `dataset-events` (768 dims, cosine) |
| CockroachDB | Removed — folded into D1 |
| `apps/slack-bot` + `apps/webhook` | `src/channels/slack.ts` + `src/api/channels.ts` |
| K8s / Helm | `wrangler deploy` |

## Setup

```bash
pnpm install

# 1. Create Cloudflare resources
wrangler d1 create boilerplate-db          # paste the ID into wrangler.jsonc
wrangler vectorize create dataset-events --dimensions=768 --metric=cosine
wrangler r2 bucket create boilerplate-files

# 2. Secrets
wrangler secret put AUTH_JWT_SECRET        # any long random string
wrangler secret put TOKEN_ENCRYPTION_KEY   # 32 random bytes, base64url-encoded
wrangler secret put CF_ACCOUNT_ID          # your Cloudflare account ID
wrangler secret put CF_ANALYTICS_TOKEN     # API token with Account Analytics:Read
wrangler secret put OPENAI_API_KEY
# Optional Slack integration:
wrangler secret put SLACK_SIGNING_SECRET
wrangler secret put SLACK_CLIENT_ID
wrangler secret put SLACK_CLIENT_SECRET

# 3. Apply schema + seed admin
npm run db:migrate
node scripts/seed-admin.mjs > /tmp/seed.sql   # password printed to stderr
wrangler d1 execute DB --remote --file /tmp/seed.sql

# 4. Deploy
npm run deploy
```

Local dev:

```bash
cp .dev.vars.example .dev.vars
cp apps/frontend/.env.local.example apps/frontend/.env.local
pnpm db:migrate:local
pnpm dev:backend
pnpm dev:frontend
```

## Frontend integration

| Old | New |
|---|---|
| Restack engine REST (`:6233`) | `https://<worker>/api/...` (Bearer JWT from `/api/auth/login`) |
| Conversation stream (`:9233`) | Flue agent endpoint `/agents/task/<taskId>` |

## Known gaps

1. **Per-agent model** — `DEFAULT_MODEL` env var used for all agents; per-agent `model` column delivered in briefing but doesn't switch harness model yet.
2. **`python_code` metrics** — records `unsupported` result; needs Cloudflare Container executor.
3. **Binary file ingestion (PDF)** — `dataset-ingest.ts` handles text; PDF extraction needs a Container.
4. **Migrated bcrypt passwords** — existing Postgres users must use `/api/auth/forgot-password` once.
5. **Password-reset email** — token returned in response for dev; wire an email provider for production.
