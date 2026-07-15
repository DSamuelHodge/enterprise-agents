/**
 * Trace processor — port of src/tracing/ClickHouseTracingProcessor.
 *
 * The Python original batched OpenAI Agents SDK spans (batch_size=1000 prod /
 * 10 dev, flush every 5s/2s) into ClickHouse. On Workers, Analytics Engine's
 * writeDataPoint is already fire-and-forget with platform-side batching, so
 * the client-side batch buffer is unnecessary; each span is written directly
 * and Cloudflare handles aggregation. The processor shape is preserved so
 * agent/workflow code records spans the same way the Python backend did.
 */
import type { Env } from '../env.d.ts';
import { writeTraceSpan } from './engine.ts';
import { uuid } from '../shared/crypto.ts';

export interface SpanHandle {
  traceId: string;
  spanId: string;
  end(payload?: unknown, error?: boolean): void;
}

export class TraceRecorder {
  constructor(
    private env: Env,
    private ctx: { workspaceId: string; taskId?: string; agentId?: string },
    readonly traceId: string = uuid(),
  ) {}

  startSpan(spanType: string, name: string, parentSpanId?: string): SpanHandle {
    const spanId = uuid();
    const startedAtMs = Date.now();
    const { env, ctx, traceId } = this;
    return {
      traceId,
      spanId,
      end: (payload?: unknown, error = false) => {
        writeTraceSpan(env, {
          workspaceId: ctx.workspaceId,
          traceId,
          spanId,
          parentSpanId,
          taskId: ctx.taskId,
          agentId: ctx.agentId,
          spanType,
          name,
          payload,
          startedAtMs,
          endedAtMs: Date.now(),
          error,
        });
      },
    };
  }

  /** Convenience wrapper: time an async operation as a span. */
  async span<T>(spanType: string, name: string, fn: () => Promise<T>, parentSpanId?: string): Promise<T> {
    const handle = this.startSpan(spanType, name, parentSpanId);
    try {
      const result = await fn();
      handle.end();
      return result;
    } catch (err) {
      handle.end({ error: String(err) }, true);
      throw err;
    }
  }
}
