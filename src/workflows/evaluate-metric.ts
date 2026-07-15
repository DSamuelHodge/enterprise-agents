import { getCloudflareContext } from '@flue/runtime/cloudflare';
import { defineWorkflow } from '@flue/runtime';
import * as v from 'valibot';
import type { Env } from '../env.d.ts';
import task from '../agents/task.ts';
import { json } from '../db/client.ts';
import { getMetricDefinitionById, getTaskById } from '../db/repos/tasks.ts';
import { writeTaskMetric } from '../analytics/engine.ts';

export function evaluateFormula(expr: string, vars: Record<string, number>): number {
  let pos = 0;
  const s = expr;
  const peek = () => s.slice(pos).match(/^\s*/)![0].length + pos;
  const skip = () => { pos = peek(); };
  const eat = (re: RegExp): string | null => { skip(); const m = s.slice(pos).match(re); if (!m || m.index !== 0) return null; pos += m[0].length; return m[0]; };
  function atom(): number {
    const num = eat(/^\d+(\.\d+)?/); if (num) return Number(num);
    const ident = eat(/^[a-zA-Z_][a-zA-Z0-9_]*/); if (ident) { if (!(ident in vars)) throw new Error(`unknown variable: ${ident}`); return vars[ident]!; }
    if (eat(/^\(/)) { const val = orExpr(); if (!eat(/^\)/)) throw new Error('expected )'); return val; }
    throw new Error(`unexpected token at: ${s.slice(pos, pos + 12)}`);
  }
  function unary(): number { if (eat(/^-/)) return -unary(); return atom(); }
  function prod(): number { let v = unary(); for (;;) { if (eat(/^\*/)) v *= unary(); else if (eat(/^\//)) v /= unary(); else return v; } }
  function sum(): number { let v = prod(); for (;;) { if (eat(/^\+/)) v += prod(); else if (eat(/^-/)) v -= prod(); else return v; } }
  function cmp(): number { const l = sum(); const op = eat(/^(<=|>=|==|!=|<|>)/); if (!op) return l; const r = sum(); switch(op) { case '<': return l<r?1:0; case '<=': return l<=r?1:0; case '>': return l>r?1:0; case '>=': return l>=r?1:0; case '==': return l===r?1:0; case '!=': return l!==r?1:0; default: throw new Error('unreachable'); } }
  function andExpr(): number { let v = cmp(); while (eat(/^&&/)) v = cmp()!==0&&v!==0?1:0; return v; }
  function orExpr(): number { let v = andExpr(); while (eat(/^\|\|/)) v = andExpr()!==0||v!==0?1:0; return v; }
  const result = orExpr(); skip(); if (pos !== s.length) throw new Error(`trailing input at: ${s.slice(pos, pos+12)}`); return result;
}

const inputSchema = v.object({
  workspaceId: v.string(),
  metricDefinitionId: v.string(),
  taskId: v.string(),
  taskInput: v.optional(v.string()),
  taskOutput: v.optional(v.string()),
  variables: v.optional(v.record(v.string(), v.number())),
});

export default defineWorkflow({
  // Fix 2: beta.9 requires agent field
  agent: task,
  input: inputSchema,
  // Fix 2: run receives {harness, input} — env via getCloudflareContext()
  async run({ harness, input }: { harness: any; input: v.InferOutput<typeof inputSchema> }) {
    const env = getCloudflareContext().env as unknown as Env;
    const started = Date.now();
    const metric = await getMetricDefinitionById(env.DB, input.metricDefinitionId);
    if (!metric || metric.is_active !== 1) {
      return { evaluated: false, reason: 'metric missing or inactive', metric: null, passed: null, score: null, reasoning: null };
    }
    const taskRow = await getTaskById(env.DB, input.taskId);
    if (!taskRow) {
      return { evaluated: false, reason: 'task not found', metric: null, passed: null, score: null, reasoning: null };
    }

    const config = json<Record<string, unknown>>(metric.config, {});
    let passed: boolean | undefined, score: number | undefined, reasoning = '';

    if (metric.metric_type === 'llm_judge') {
      const judgePrompt = String(config['prompt'] ?? config['judge_prompt'] ?? 'Judge whether the task output satisfies the task input.');
      const taskInput = input.taskInput ?? taskRow.description ?? taskRow.title;
      const taskOutput = input.taskOutput ?? json<{ summary?: string }>(taskRow.agent_state, {}).summary ?? '';
      // Fix 3: await harness.session() — returns Promise<FlueSession> in beta.9
      const session = await harness.session();
      const verdict = await session.prompt([judgePrompt, '', '--- TASK INPUT ---', taskInput, '--- TASK OUTPUT ---', taskOutput, '', 'Respond with exactly one line of JSON: {"passed": true|false, "score": 0-100, "reasoning": "..."}'].join('\n'));
      try {
        const parsed = JSON.parse(String(verdict).trim().replace(/^```json?\s*|\s*```$/g, ''));
        passed = Boolean(parsed.passed); score = typeof parsed.score === 'number' ? parsed.score : undefined; reasoning = String(parsed.reasoning ?? '');
      } catch { passed = false; reasoning = `judge returned unparseable verdict: ${String(verdict).slice(0, 300)}`; }
    } else if (metric.metric_type === 'formula') {
      const expr = String(config['formula'] ?? config['expression'] ?? '');
      try {
        const value = evaluateFormula(expr, input.variables ?? {});
        score = value;
        const threshold = typeof config['threshold'] === 'number' ? (config['threshold'] as number) : undefined;
        passed = threshold !== undefined ? value >= threshold : value !== 0;
        reasoning = `formula '${expr}' = ${value}${threshold !== undefined ? ` (threshold ${threshold})` : ''}`;
      } catch (err) { passed = false; reasoning = `formula error: ${String(err)}`; }
    } else {
      passed = undefined;
      reasoning = 'python_code metrics are not executable on the Workers runtime; wire a Flue sandbox / Cloudflare Container executor to enable them.';
    }

    writeTaskMetric(env, { workspaceId: input.workspaceId, taskId: input.taskId, agentId: taskRow.agent_id, metricCategory: metric.category || 'quality', metricName: metric.name, metricType: metric.metric_type, metricDefinitionId: metric.id, passed, score, reasoning, evalDurationMs: Date.now() - started });
    return {
      evaluated: true,
      reason: null,
      metric: metric.name,
      passed: passed ?? null,
      score: score ?? null,
      reasoning,
    };
  },
});
