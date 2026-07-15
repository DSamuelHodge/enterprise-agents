/**
 * Workers Analytics Engine layer — replaces ClickHouse.
 *
 * Writes: dataset bindings (TASK_METRICS, TASK_TRACES, PIPELINE_EVENTS).
 * Reads: the Analytics Engine SQL API
 *   POST https://api.cloudflare.com/client/v4/accounts/{account}/analytics_engine/sql
 * (Analytics Engine is Cloudflare's own ClickHouse fleet; the SQL surface is a
 * ClickHouse-SQL subset — no ARRAY JOIN / window functions, per migration doc §4.3.)
 *
 * Dimension budget per data point: up to 20 blobs (string), 20 doubles
 * (number), 1 index. Column mappings below are the ClickHouse-schema port and
 * MUST stay stable — AE columns are positional (blob1, double2, ...).
 */
import type { Env } from '../env.d.ts';

// ── task_metrics ─────────────────────────────────────────────────────────────
// ClickHouse task_metrics -> AE 'task_metrics'
// index1  = workspace_id            (sampling key / fast filter)
// blob1   = task_id        blob2 = agent_id       blob3 = agent_name
// blob4   = parent_agent_id blob5 = agent_version blob6 = response_id
// blob7   = metric_category blob8 = metric_name   blob9 = metric_type
// blob10  = metric_definition_id    blob11 = status
// blob12  = reasoning (truncated)   blob13 = trace_id  blob14 = span_id
// double1 = duration_ms    double2 = input_tokens  double3 = output_tokens
// double4 = cost_usd       double5 = passed (0/1)  double6 = score
// double7 = eval_duration_ms double8 = eval_cost_usd
// double9 = response_index  double10 = message_count

export interface TaskMetricPoint {
  workspaceId: string;
  taskId: string;
  agentId: string;
  agentName?: string;
  parentAgentId?: string;
  agentVersion?: string;
  responseId?: string;
  responseIndex?: number;
  messageCount?: number;
  metricCategory: 'performance' | 'quality' | 'feedback' | string;
  metricName?: string;
  metricType?: string;
  metricDefinitionId?: string;
  status?: string;
  durationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  passed?: boolean;
  score?: number;
  reasoning?: string;
  evalDurationMs?: number;
  evalCostUsd?: number;
  traceId?: string;
  spanId?: string;
}

export function writeTaskMetric(env: Env, p: TaskMetricPoint): void {
  env.TASK_METRICS.writeDataPoint({
    indexes: [p.workspaceId],
    blobs: [
      p.taskId, p.agentId, p.agentName ?? '', p.parentAgentId ?? '',
      p.agentVersion ?? 'v1', p.responseId ?? '', p.metricCategory,
      p.metricName ?? '', p.metricType ?? '', p.metricDefinitionId ?? '',
      p.status ?? '', (p.reasoning ?? '').slice(0, 4096), p.traceId ?? '', p.spanId ?? '',
    ],
    doubles: [
      p.durationMs ?? 0, p.inputTokens ?? 0, p.outputTokens ?? 0, p.costUsd ?? 0,
      p.passed === undefined ? -1 : p.passed ? 1 : 0, p.score ?? -1,
      p.evalDurationMs ?? 0, p.evalCostUsd ?? 0,
      p.responseIndex ?? 0, p.messageCount ?? 0,
    ],
  });
}

// ── task_traces ──────────────────────────────────────────────────────────────
// index1 = workspace_id
// blob1 = trace_id  blob2 = span_id  blob3 = parent_span_id  blob4 = task_id
// blob5 = agent_id  blob6 = span_type  blob7 = name  blob8 = payload (JSON, truncated)
// double1 = started_at_ms  double2 = ended_at_ms  double3 = duration_ms  double4 = error(0/1)

export interface TraceSpanPoint {
  workspaceId: string;
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  taskId?: string;
  agentId?: string;
  spanType: string;
  name: string;
  payload?: unknown;
  startedAtMs: number;
  endedAtMs: number;
  error?: boolean;
}

export function writeTraceSpan(env: Env, s: TraceSpanPoint): void {
  env.TASK_TRACES.writeDataPoint({
    indexes: [s.workspaceId],
    blobs: [
      s.traceId, s.spanId, s.parentSpanId ?? '', s.taskId ?? '', s.agentId ?? '',
      s.spanType, s.name, JSON.stringify(s.payload ?? {}).slice(0, 4096),
    ],
    doubles: [s.startedAtMs, s.endedAtMs, Math.max(0, s.endedAtMs - s.startedAtMs), s.error ? 1 : 0],
  });
}

// ── pipeline_events ──────────────────────────────────────────────────────────
// ClickHouse/CockroachDB pipeline_events -> AE 'pipeline_events'.
// The embedding Array(Float32) column moved to Vectorize (see workflows/dataset-ingest.ts);
// AE keeps the event record and Vectorize keeps the vector, joined by event id in metadata.
// index1 = workspace_id
// blob1 = event_id  blob2 = agent_id  blob3 = task_id  blob4 = dataset_id
// blob5 = event_name  blob6 = raw_data (JSON, truncated)  blob7 = transformed_data
// blob8 = tags (JSON array)
// double1 = event_timestamp_ms

export interface PipelineEventPoint {
  workspaceId: string;
  eventId: string;
  agentId: string;
  taskId?: string;
  datasetId?: string;
  eventName: string;
  rawData: unknown;
  transformedData?: unknown;
  tags?: string[];
  eventTimestampMs: number;
}

export function writePipelineEvent(env: Env, e: PipelineEventPoint): void {
  env.PIPELINE_EVENTS.writeDataPoint({
    indexes: [e.workspaceId],
    blobs: [
      e.eventId, e.agentId, e.taskId ?? '', e.datasetId ?? '', e.eventName,
      JSON.stringify(e.rawData ?? {}).slice(0, 5120),
      e.transformedData !== undefined ? JSON.stringify(e.transformedData).slice(0, 2048) : '',
      JSON.stringify(e.tags ?? []),
    ],
    doubles: [e.eventTimestampMs],
  });
}

// ── SQL API reads ────────────────────────────────────────────────────────────

export async function queryAnalytics<T = Record<string, unknown>>(
  env: Env,
  sql: string,
): Promise<T[]> {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/analytics_engine/sql`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.CF_ANALYTICS_TOKEN}`,
        'Content-Type': 'text/plain',
      },
      body: `${sql} FORMAT JSON`,
    },
  );
  if (!res.ok) {
    throw new Error(`Analytics Engine SQL API error ${res.status}: ${await res.text()}`);
  }
  const body = (await res.json()) as { data: T[] };
  return body.data ?? [];
}

/** Escape a string literal for the AE SQL API (single-quote doubling). */
export function sqlStr(v: string): string {
  return `'${v.replaceAll("'", "''")}'`;
}

// ── Query ports of traces_query.py / task_metrics_crud.py / analytics_metrics.py ──

export function getTaskMetrics(env: Env, workspaceId: string, taskId: string) {
  return queryAnalytics(env, `
    SELECT blob7 AS metric_category, blob8 AS metric_name, blob9 AS metric_type,
           blob6 AS response_id, blob11 AS status, blob12 AS reasoning,
           double1 AS duration_ms, double2 AS input_tokens, double3 AS output_tokens,
           double4 AS cost_usd, double5 AS passed, double6 AS score,
           timestamp
    FROM task_metrics
    WHERE index1 = ${sqlStr(workspaceId)} AND blob1 = ${sqlStr(taskId)}
    ORDER BY timestamp DESC
    LIMIT 500`);
}

export function getTaskTraces(env: Env, workspaceId: string, taskId: string) {
  return queryAnalytics(env, `
    SELECT blob1 AS trace_id, blob2 AS span_id, blob3 AS parent_span_id,
           blob6 AS span_type, blob7 AS name, blob8 AS payload,
           double1 AS started_at_ms, double2 AS ended_at_ms,
           double3 AS duration_ms, double4 AS error
    FROM task_traces
    WHERE index1 = ${sqlStr(workspaceId)} AND blob4 = ${sqlStr(taskId)}
    ORDER BY double1 ASC
    LIMIT 2000`);
}

/** analytics_metrics.py: workspace overview aggregates over an interval (days). */
export function getAnalyticsOverview(env: Env, workspaceId: string, days = 30) {
  return queryAnalytics(env, `
    SELECT blob2 AS agent_id, blob5 AS agent_version,
           count() AS runs,
           sum(double4) AS total_cost_usd,
           sum(double2) AS total_input_tokens,
           sum(double3) AS total_output_tokens,
           avg(double1) AS avg_duration_ms,
           countIf(double5 = 1) AS passed_count,
           countIf(double5 = 0) AS failed_count
    FROM task_metrics
    WHERE index1 = ${sqlStr(workspaceId)}
      AND timestamp > now() - INTERVAL '${Math.max(1, Math.min(365, Math.floor(days)))}' DAY
    GROUP BY agent_id, agent_version
    ORDER BY runs DESC
    LIMIT 200`);
}

/** tasks_by_metrics.py: task ids failing a given metric in the interval. */
export function getTasksByMetricFailure(env: Env, workspaceId: string, metricName: string, days = 30) {
  return queryAnalytics<{ task_id: string; failures: number }>(env, `
    SELECT blob1 AS task_id, count() AS failures
    FROM task_metrics
    WHERE index1 = ${sqlStr(workspaceId)} AND blob8 = ${sqlStr(metricName)} AND double5 = 0
      AND timestamp > now() - INTERVAL '${Math.max(1, Math.min(365, Math.floor(days)))}' DAY
    GROUP BY task_id ORDER BY failures DESC LIMIT 200`);
}

/** feedback_metrics.py: feedback rows are task_metrics with category 'feedback'. */
export function getFeedbackAnalytics(env: Env, workspaceId: string, days = 30) {
  return queryAnalytics(env, `
    SELECT blob2 AS agent_id,
           countIf(double6 > 0) AS positive,
           countIf(double6 <= 0) AS negative,
           count() AS total
    FROM task_metrics
    WHERE index1 = ${sqlStr(workspaceId)} AND blob7 = 'feedback'
      AND timestamp > now() - INTERVAL '${Math.max(1, Math.min(365, Math.floor(days)))}' DAY
    GROUP BY agent_id ORDER BY total DESC LIMIT 200`);
}

/** datasets query (query_dataset_events port): recent events for a dataset. */
export function getDatasetEvents(env: Env, workspaceId: string, datasetId: string, limit = 100) {
  return queryAnalytics(env, `
    SELECT blob1 AS event_id, blob2 AS agent_id, blob3 AS task_id,
           blob5 AS event_name, blob6 AS raw_data, blob8 AS tags,
           double1 AS event_timestamp_ms, timestamp AS ingested_at
    FROM pipeline_events
    WHERE index1 = ${sqlStr(workspaceId)} AND blob4 = ${sqlStr(datasetId)}
    ORDER BY timestamp DESC
    LIMIT ${Math.max(1, Math.min(1000, Math.floor(limit)))}`);
}
