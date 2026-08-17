import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { env as workerEnv } from 'cloudflare:workers';
import { registerProvider } from '@flue/runtime';
// Fix 1: flue() is exported from the /routing subpath in beta.9, not the root.
import { flue } from '@flue/runtime/routing';
import type { ApiEnv } from './api/middleware.ts';
import api from './api/index.ts';

const app = new Hono<ApiEnv>();

app.onError((error, c) => {
  console.error('Unhandled Worker error', error);
  return c.json({ error: 'Internal Server Error' }, 500);
});

// Keep the managed Cloudflare model path explicit so every task uses the
// configured AI Gateway instead of relying on an implicit runtime default.
registerProvider('cloudflare', {
  api: 'cloudflare-ai-binding',
  binding: workerEnv.AI,
  gateway: {
    id: workerEnv.AI_GATEWAY_ID || 'default',
    collectLog: true,
    metadata: { application: 'enterprise-agents' },
  },
});

app.use('*', cors({
  origin: (origin, c) => {
    const allowed = (c.env as { FRONTEND_URL?: string }).FRONTEND_URL;
    return origin === allowed ? origin : allowed ?? '';
  },
  allowHeaders: ['Authorization', 'Content-Type'],
  allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
}));

app.get('/health', (c) => c.json({ ok: true, service: 'boilerplate-backend' }));

// REST API for the Next.js frontend.
app.route('/api', api);

// Flue runtime: agents, workflows, Slack channel ingress.
app.route('/', flue());

export default app;
