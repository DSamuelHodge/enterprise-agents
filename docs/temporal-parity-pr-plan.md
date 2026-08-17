# Restack/Temporal Parity PR Plan

Status: proposed

This plan breaks the remaining Restack/Temporal backend compromises into reviewable PRs. The goal is not to preserve Temporal as an implementation detail; the goal is to make the Flue + Cloudflare backend expose the same product capabilities the original Restack backend provided for executions, logs, auditability, metrics, and integrations.

## Definition Of Done

The migration is considered 1:1 for backend execution behavior when:

- Every user-visible task, agent, workflow, integration, dataset, and schedule mutation creates an immutable audit event.
- Task and agent runs stream logs/events to the frontend in real time and can resume after reconnect without losing history.
- Workflow executions have queryable status, input, output, errors, retries, timing, and event history comparable to Temporal visibility.
- LLM calls, MCP tool calls, workflow steps, dataset ingest work, schedules, and integration callbacks produce linked traces and metrics.
- Operators can answer: who changed what, what executed, what failed, what retried, what model/tool was called, and what the user saw.
- Tests cover the compatibility contracts the frontend depends on, not only the new Cloudflare implementation.

## PR 1: Immutable Audit And Event Journal

Branch: `codex/audit-event-journal`

Scope:

- Add D1 migrations for `audit_events`, `task_events`, and supporting indexes.
- Add a backend event writer with stable event ids, timestamps, actor metadata, workspace/task/agent references, and structured payloads.
- Emit audit events from auth, agent CRUD, task CRUD, channel operations, MCP server operations, dataset operations, schedules, and workflow submissions.
- Add read endpoints for audit history and task event history.
- Keep Workers Analytics Engine for analytical aggregates, but make D1 the source of truth for exact audit history.

Acceptance criteria:

- Creating, updating, deleting, and executing core entities leaves immutable audit rows.
- API tests prove event rows are written for representative mutation paths.
- Audit records include enough metadata to reconstruct the action without querying volatile runtime state.

## PR 2: Real-Time Logs With Durable Resume

Branch: `codex/realtime-task-events`

Scope:

- Add a Durable Object stream room per task or execution.
- Publish task/agent/model/tool/workflow events to both D1 history and live WebSocket or SSE subscribers.
- Add sequence cursors so the frontend can reconnect and replay missed events.
- Replace the current frontend polling fallback for task logs with the resumable live stream.

Acceptance criteria:

- Task messages, agent output, tool calls, errors, and workflow state changes appear without refresh.
- Reconnecting with a cursor backfills missed events in order.
- Events are still queryable after the Durable Object has no active clients.

## PR 3: Workflow Execution Visibility

Branch: `codex/workflow-execution-visibility`

Scope:

- Add D1 tables for `workflow_executions` and `workflow_execution_events`.
- Wrap Flue workflow submissions with execution id, run id, status, attempt, parent task, input hash, output, and error capture.
- Track queued, started, step completed, retried, failed, canceled, timed out, and completed states.
- Add REST endpoints that mirror the frontend's previous execution-history needs.

Acceptance criteria:

- Every submitted workflow has a durable execution record.
- Failed and retried executions preserve error details and attempt counts.
- The frontend can display execution status and history without reaching into Flue internals.

## PR 4: Trace Coverage Parity

Branch: `codex/trace-coverage-parity`

Scope:

- Standardize trace ids and span ids across API requests, workflows, agents, LLM calls, MCP calls, dataset ingest, and schedules.
- Add a small tracing helper that records spans to Workers Analytics Engine and links them back to D1 audit/task/workflow records.
- Ensure model input/output metadata is captured safely without leaking secrets.
- Add trace query endpoints that support task-level and execution-level drilldown.

Acceptance criteria:

- A task execution can be followed from API request to workflow to LLM/tool call to final result.
- Trace gaps are covered by tests or explicit TODOs tied to open issues.
- Sensitive values are redacted before being written to analytics.

## PR 5: Metrics And Analytics Hardening

Branch: `codex/analytics-engine-parity`

Scope:

- Finish Workers Analytics Engine query support for task metrics, traces, and pipeline events.
- Add schema/version guards around metric writes.
- Add D1-derived fallback summaries for dashboards that require exact counts.
- Document retention, cardinality limits, and query assumptions.

Acceptance criteria:

- Dashboard metrics match D1 source-of-truth records for core counters.
- Analytics Engine failures do not break user-facing mutations.
- Metric writes are observable and testable.

## PR 6: MCP Integration Execution Parity

Branch: `codex/mcp-execution-parity`

Scope:

- Implement full MCP server connection, discovery, tool invocation, authentication metadata, and error recording.
- Route MCP tool calls through the same task event, audit, trace, and metrics paths as native tools.
- Add contract tests for remote MCP directory entries and connected server execution.

Acceptance criteria:

- Connected MCP servers can list tools and execute tool calls from a task run.
- Tool call inputs, outputs, failures, and authorization context appear in execution history.
- Frontend integration detail pages no longer rely on adapter stubs.

## PR 7: Durable Versioning And Migration Safety

Branch: `codex/durable-versioning`

Scope:

- Add workflow and agent version metadata to execution records.
- Introduce compatibility gates for long-running workflow behavior changes.
- Document how Flue/Cloudflare versioning maps to the original Temporal `patched()` migration pattern.
- Add tests proving old execution records can still be read after handler upgrades.

Acceptance criteria:

- New workflow behavior can be introduced without corrupting existing executions.
- Version metadata is visible in execution history.
- Migration guidance is documented for future backend changes.

## Review Order

1. PR 1 must land first because later work depends on stable event persistence.
2. PR 2 and PR 3 can proceed in parallel once the event writer exists.
3. PR 4 depends on the execution and task event ids from PRs 1-3.
4. PR 5 can run alongside PR 4, but must reconcile with the same trace and event identifiers.
5. PR 6 should land after PR 1 and PR 4 so external tool calls are fully auditable.
6. PR 7 can begin after PR 3 establishes the execution visibility schema.

## Non-Goals

- Reintroducing Temporal, Kubernetes, Postgres, ClickHouse, or CockroachDB.
- Treating Workers Analytics Engine as the only audit source of truth.
- Rewriting the frontend again unless a parity feature requires a focused integration point.
