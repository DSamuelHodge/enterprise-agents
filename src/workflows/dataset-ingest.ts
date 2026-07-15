import { getCloudflareContext } from '@flue/runtime/cloudflare';
import { defineWorkflow } from '@flue/runtime';
import * as v from 'valibot';
import type { Env } from '../env.d.ts';
import task from '../agents/task.ts';
import { uuid } from '../shared/crypto.ts';
import { writePipelineEvent } from '../analytics/engine.ts';
import { updateDataset } from '../db/repos/tasks.ts';

const EMBED_MODEL = '@cf/baai/bge-base-en-v1.5';
const CHUNK_CHARS = 2000, CHUNK_OVERLAP = 200, EMBED_BATCH = 25;

function chunkText(text: string): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(text.length, start + CHUNK_CHARS);
    chunks.push(text.slice(start, end));
    if (end === text.length) break;
    start = end - CHUNK_OVERLAP;
  }
  return chunks.filter((c) => c.trim().length > 0);
}

const inputSchema = v.object({
  workspaceId: v.string(),
  datasetId: v.string(),
  agentId: v.string(),
  r2Key: v.string(),
  fileName: v.optional(v.string()),
  tags: v.optional(v.array(v.string())),
});

export default defineWorkflow({
  agent: task,
  input: inputSchema,
  async run({ input }: { input: v.InferOutput<typeof inputSchema> }) {
    const env = getCloudflareContext().env as unknown as Env;
    const obj = await env.FILES.get(input.r2Key);
    if (!obj) return { ingested: 0, chunks: 0, error: `R2 object not found: ${input.r2Key}` };
    const text = await obj.text();
    const chunks = chunkText(text);
    if (chunks.length === 0) return { ingested: 0, chunks: 0, error: 'no text content' };

    let ingested = 0;
    for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
      const batch = chunks.slice(i, i + EMBED_BATCH);
      const res = (await env.AI.run(EMBED_MODEL, { text: batch })) as { data: number[][] };
      const vectors = batch.map((chunk, j) => {
        const eventId = uuid();
        writePipelineEvent(env, { workspaceId: input.workspaceId, eventId, agentId: input.agentId, datasetId: input.datasetId, eventName: 'dataset.chunk.ingested', rawData: { source: input.fileName ?? input.r2Key, chunk_index: i + j, text_preview: chunk.slice(0, 500) }, tags: input.tags ?? [], eventTimestampMs: Date.now() });
        return { id: eventId, values: res.data[j]!, metadata: { workspace_id: input.workspaceId, dataset_id: input.datasetId, agent_id: input.agentId, source: input.fileName ?? input.r2Key, chunk_index: i + j, text: chunk.slice(0, 1000) } };
      });
      await env.VECTORIZE.upsert(vectors);
      ingested += vectors.length;
    }
    await updateDataset(env.DB, input.datasetId, { touchLastUpdated: true });
    return { ingested, chunks: chunks.length, error: null };
  },
});
