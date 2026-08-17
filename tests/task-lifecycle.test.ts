import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const repoPath = (path: string) => resolve(import.meta.dirname, '..', path);

const files = {
  migration: readFileSync(repoPath('migrations/0003_task_cancel_and_default_model.sql'), 'utf8'),
  types: readFileSync(repoPath('src/db/types.ts'), 'utf8'),
  api: readFileSync(repoPath('src/api/tasks.ts'), 'utf8'),
  agent: readFileSync(repoPath('src/agents/task.ts'), 'utf8'),
  streamProvider: readFileSync(
    repoPath('apps/frontend/app/(dashboard)/agents/[agentId]/providers/agent-stream-provider.tsx'),
    'utf8',
  ),
  chat: readFileSync(
    repoPath('apps/frontend/app/(dashboard)/tasks/[taskId]/components/task-chat-interface.tsx'),
    'utf8',
  ),
};

test('task lifecycle includes an explicit cancelled terminal state', () => {
  assert.match(files.migration, /'cancelled'/);
  assert.match(files.types, /TaskStatus = .*'cancelled'/);
  assert.match(files.agent, /isTerminalTaskStatus[\s\S]*cancelled/);
});

test('task API exposes a cancel endpoint instead of requiring raw DB edits', () => {
  assert.match(files.api, /tasks\.post\('\/workspaces\/:workspaceId\/tasks\/:taskId\/cancel'/);
  assert.match(files.api, /status: 'cancelled'/);
});

test('frontend treats cancelled tasks as terminal', () => {
  assert.match(files.streamProvider, /taskStatus === 'cancelled'/);
  assert.match(files.chat, /task\?\.status === "cancelled"/);
});
