import { Hono } from 'hono';
import { invoke } from '@flue/runtime';
import type { ApiEnv } from './middleware.ts';
import { assertMembership } from './middleware.ts';
import { createDataset, createMetricDefinition, deleteDataset, deleteMetricDefinition, getDatasetById, listDatasets, listMetricDefinitions, updateDataset, updateMetricDefinition } from '../db/repos/tasks.ts';
import { getAnalyticsOverview, getDatasetEvents, getFeedbackAnalytics, getTaskMetrics, getTaskTraces, getTasksByMetricFailure } from '../analytics/engine.ts';
import { uuid } from '../shared/crypto.ts';
import datasetIngest from '../workflows/dataset-ingest.ts';
import retroactiveMetrics from '../workflows/retroactive-metrics.ts';
import type { MetricType } from '../db/types.ts';

const EMBED_MODEL = '@cf/baai/bge-base-en-v1.5';
const data = new Hono<ApiEnv>();

data.get('/workspaces/:workspaceId/datasets', async (c) => {
  const g = await assertMembership(c, c.req.param('workspaceId')); if (g) return g;
  return c.json({ datasets: await listDatasets(c.env.DB, c.req.param('workspaceId')) });
});

data.post('/workspaces/:workspaceId/datasets', async (c) => {
  const g = await assertMembership(c, c.req.param('workspaceId')); if (g) return g;
  const body = await c.req.json<Record<string, unknown>>();
  try {
    return c.json({ dataset: await createDataset(c.env.DB, { workspaceId: c.req.param('workspaceId'), name: String(body['name'] ?? ''), description: body['description'] as string ?? null, storageType: body['storage_type'] as 'analytics_engine'|'d1' | undefined, storageConfig: body['storage_config'], buildTaskId: body['build_task_id'] as string ?? null }) }, 201);
  } catch (err) { return c.json({ error: String(err) }, 400); }
});

data.patch('/workspaces/:workspaceId/datasets/:datasetId', async (c) => {
  const g = await assertMembership(c, c.req.param('workspaceId')); if (g) return g;
  const body = await c.req.json<Record<string, unknown>>();
  return c.json({ dataset: await updateDataset(c.env.DB, c.req.param('datasetId'), { description: body['description'] as string | undefined, storageConfig: body['storage_config'] }) });
});

data.delete('/workspaces/:workspaceId/datasets/:datasetId', async (c) => {
  const g = await assertMembership(c, c.req.param('workspaceId')); if (g) return g;
  await deleteDataset(c.env.DB, c.req.param('datasetId'));
  return c.json({ ok: true });
});

data.post('/workspaces/:workspaceId/datasets/:datasetId/upload', async (c) => {
  const g = await assertMembership(c, c.req.param('workspaceId')); if (g) return g;
  const dataset = await getDatasetById(c.env.DB, c.req.param('datasetId'));
  if (!dataset || dataset.workspace_id !== c.req.param('workspaceId')) return c.json({ error: 'not found' }, 404);
  const fileName = c.req.query('file_name') ?? 'upload.txt';
  const agentId = c.req.query('agent_id') ?? '';
  const key = `datasets/${dataset.id}/${uuid()}-${fileName}`;
  await c.env.FILES.put(key, c.req.raw.body);
  const { runId } = await invoke(datasetIngest, { input: { workspaceId: c.req.param('workspaceId'), datasetId: dataset.id, agentId, r2Key: key, fileName } });
  return c.json({ ok: true, r2_key: key, runId }, 202);
});

data.get('/workspaces/:workspaceId/datasets/:datasetId/events', async (c) => {
  const g = await assertMembership(c, c.req.param('workspaceId')); if (g) return g;
  return c.json({ events: await getDatasetEvents(c.env, c.req.param('workspaceId'), c.req.param('datasetId'), Number(c.req.query('limit') ?? '100')) });
});

data.post('/workspaces/:workspaceId/datasets/:datasetId/search', async (c) => {
  const g = await assertMembership(c, c.req.param('workspaceId')); if (g) return g;
  const body = await c.req.json<{ query?: string; top_k?: number }>();
  if (!body.query) return c.json({ error: 'query required' }, 400);
  const embedded = (await c.env.AI.run(EMBED_MODEL, { text: [body.query] })) as { data: number[][] };
  const matches = await c.env.VECTORIZE.query(embedded.data[0]!, { topK: Math.max(1, Math.min(50, body.top_k ?? 10)), filter: { dataset_id: c.req.param('datasetId') }, returnMetadata: 'all' });
  return c.json({ matches: matches.matches.map((m) => ({ id: m.id, score: m.score, metadata: m.metadata })) });
});

data.get('/workspaces/:workspaceId/metrics', async (c) => {
  const g = await assertMembership(c, c.req.param('workspaceId')); if (g) return g;
  return c.json({ metrics: await listMetricDefinitions(c.env.DB, c.req.param('workspaceId'), c.req.query('active') === 'true') });
});

data.post('/workspaces/:workspaceId/metrics', async (c) => {
  const g = await assertMembership(c, c.req.param('workspaceId')); if (g) return g;
  const body = await c.req.json<Record<string, unknown>>();
  if (!body['name'] || !body['metric_type']) return c.json({ error: 'name and metric_type required' }, 400);
  const metric = await createMetricDefinition(c.env.DB, { workspaceId: c.req.param('workspaceId'), name: String(body['name']), description: body['description'] as string ?? null, category: body['category'] as string ?? 'quality', metricType: body['metric_type'] as MetricType, config: body['config'] ?? {}, createdBy: c.get('userId'), parentAgentIds: body['parent_agent_ids'] as string[] ?? [] });
  let retroactiveRunId: string | undefined;
  if (body['retroactive'] === true) {
    const { runId } = await invoke(retroactiveMetrics, { input: { workspaceId: c.req.param('workspaceId'), metricDefinitionId: metric.id, limit: body['retroactive_limit'] as number ?? 100, parentAgentIds: body['parent_agent_ids'] as string[] ?? [] } });
    retroactiveRunId = runId;
  }
  return c.json({ metric, retroactive_run_id: retroactiveRunId }, 201);
});

data.patch('/workspaces/:workspaceId/metrics/:metricId', async (c) => {
  const g = await assertMembership(c, c.req.param('workspaceId')); if (g) return g;
  const body = await c.req.json<Record<string, unknown>>();
  return c.json({ metric: await updateMetricDefinition(c.env.DB, c.req.param('metricId'), { name: body['name'] as string | undefined, description: body['description'] as string | undefined, category: body['category'] as string | undefined, config: body['config'], isActive: body['is_active'] as boolean | undefined }) });
});

data.delete('/workspaces/:workspaceId/metrics/:metricId', async (c) => {
  const g = await assertMembership(c, c.req.param('workspaceId')); if (g) return g;
  await deleteMetricDefinition(c.env.DB, c.req.param('metricId'));
  return c.json({ ok: true });
});

data.get('/workspaces/:workspaceId/analytics/overview', async (c) => {
  const g = await assertMembership(c, c.req.param('workspaceId')); if (g) return g;
  return c.json({ overview: await getAnalyticsOverview(c.env, c.req.param('workspaceId'), Number(c.req.query('days') ?? '30')) });
});

data.get('/workspaces/:workspaceId/analytics/feedback', async (c) => {
  const g = await assertMembership(c, c.req.param('workspaceId')); if (g) return g;
  return c.json({ feedback: await getFeedbackAnalytics(c.env, c.req.param('workspaceId'), Number(c.req.query('days') ?? '30')) });
});

data.get('/workspaces/:workspaceId/analytics/tasks-by-metric', async (c) => {
  const g = await assertMembership(c, c.req.param('workspaceId')); if (g) return g;
  const metricName = c.req.query('metric');
  if (!metricName) return c.json({ error: 'metric query param required' }, 400);
  return c.json({ tasks: await getTasksByMetricFailure(c.env, c.req.param('workspaceId'), metricName, Number(c.req.query('days') ?? '30')) });
});

data.get('/workspaces/:workspaceId/tasks/:taskId/metrics', async (c) => {
  const g = await assertMembership(c, c.req.param('workspaceId')); if (g) return g;
  return c.json({ metrics: await getTaskMetrics(c.env, c.req.param('workspaceId'), c.req.param('taskId')) });
});

data.get('/workspaces/:workspaceId/tasks/:taskId/traces', async (c) => {
  const g = await assertMembership(c, c.req.param('workspaceId')); if (g) return g;
  return c.json({ traces: await getTaskTraces(c.env, c.req.param('workspaceId'), c.req.param('taskId')) });
});

export default data;
