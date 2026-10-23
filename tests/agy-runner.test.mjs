import test from 'node:test';
import assert from 'node:assert/strict';
import {
  diffSnapshots,
  normalizeAgyEvent,
  parseRunnerArgs,
  redactSecrets,
  summarizeCheck,
} from '../scripts/agy-runner.mjs';

test('normalizes AGY tool events without storing file contents or tool output', () => {
  const event = normalizeAgyEvent({
    event: 'step_update',
    step_update: {
      conversation_id: 'conversation-1',
      step_index: 2,
      state: 'ACTIVE',
      step_type: 'tool',
      tool_name: 'write_file',
      tool_info: {
        name: 'write_file',
        parameters: { Path: 'src/catalog.ts', Content: 'private implementation' },
        output: 'file written',
      },
    },
  });

  assert.deepEqual(event, {
    event: 'step_update',
    conversationId: 'conversation-1',
    stepIndex: 2,
    state: 'ACTIVE',
    stepType: 'tool',
    toolName: 'write_file',
    filePath: 'src/catalog.ts',
    fileActivity: 'write_or_edit',
  });
  assert.equal(JSON.stringify(event).includes('private implementation'), false);
});

test('summarizes checks only when output exposes a result', () => {
  assert.deepEqual(
    summarizeCheck('npm run test:unit', '# tests 4\n# pass 4\n# fail 0\n'),
    { kind: 'test', outcome: 'passed', counts: { tests: 4, passed: 4, failed: 0 } }
  );
  assert.deepEqual(summarizeCheck('npm run typecheck', ''), {
    kind: 'typecheck',
    outcome: 'unverified',
  });
  assert.deepEqual(
    summarizeCheck('npm run build', 'Command failed with exit code: 1'),
    { kind: 'build', outcome: 'failed', exitCode: 1 }
  );
});

test('keeps the test command summary and drops unneeded shell arguments', () => {
  const event = normalizeAgyEvent({
    event: 'step_update',
    step_update: {
      state: 'DONE',
      step_type: 'tool',
      tool_name: 'run_command',
      tool_info: {
        name: 'run_command',
        parameters: { CommandLine: 'npm run test:unit -- --token=private-value' },
        output: '# tests 1\n# pass 1\n# fail 0\n',
      },
    },
  });

  assert.equal(event.command, 'npm run test:unit');
  assert.deepEqual(event.check, {
    kind: 'test',
    outcome: 'passed',
    counts: { tests: 1, passed: 1, failed: 0 },
  });
  assert.equal(JSON.stringify(event).includes('private-value'), false);
});

test('redacts credential-shaped values from event text', () => {
  const safe = redactSecrets(
    'Authorization: Bearer abc.def token=abc123 ghp_123456789012345678901234567890'
  );
  assert.equal(safe.includes('abc.def'), false);
  assert.equal(safe.includes('abc123'), false);
  assert.equal(safe.includes('ghp_123456789012345678901234567890'), false);
});

test('reports only worktree paths that changed since the captured baseline', () => {
  const before = new Map([
    ['preexisting.ts', 'same'],
    ['changed.ts', 'before'],
  ]);
  const after = new Map([
    ['preexisting.ts', 'same'],
    ['changed.ts', 'after'],
    ['new.ts', 'new'],
  ]);

  assert.deepEqual(diffSnapshots(before, after), {
    changed: ['changed.ts', 'new.ts'],
    noLongerDirty: [],
  });
  assert.deepEqual(diffSnapshots(before, new Map([['preexisting.ts', 'same']])), {
    changed: [],
    noLongerDirty: ['changed.ts'],
  });
});

test('requires explicit task and model and refuses permission bypass flags', () => {
  assert.throws(() => parseRunnerArgs([]), /--task-file/);
  assert.throws(() => parseRunnerArgs(['--task-file', 'task.md']), /--model/);
  assert.throws(
    () => parseRunnerArgs(['--task-file', 'task.md', '--model', 'gemini-4-argon-high', '--dangerously-skip-permissions']),
    /Unknown runner option/
  );
  assert.equal(
    parseRunnerArgs(['--task-file', 'task.md', '--model', 'gemini-4-argon-high']).mode,
    'accept-edits'
  );
  assert.equal(
    parseRunnerArgs([
      '--task-file',
      'task.md',
      '--model',
      'gemini-4-argon-high',
      '--conversation',
      'conversation-123',
    ]).conversationId,
    'conversation-123'
  );
  assert.throws(
    () => parseRunnerArgs([
      '--task-file',
      'task.md',
      '--model',
      'gemini-4-argon-high',
      '--continue',
      '--conversation',
      'conversation-123',
    ]),
    /either --continue or --conversation/
  );
});

test('normalizes final result metadata without persisting the full response', () => {
  const event = normalizeAgyEvent({
    event: 'result',
    result: {
      conversation_id: 'conversation-2',
      status: 'SUCCESS',
      duration_seconds: 12.5,
      num_turns: 2,
      response: 'finished',
      usage: { total_tokens: 99 },
    },
  });
  assert.deepEqual(event, {
    event: 'result',
    conversationId: 'conversation-2',
    status: 'SUCCESS',
    durationSeconds: 12.5,
    turns: 2,
    responseChars: 8,
    usage: { total_tokens: 99 },
  });
  assert.equal(JSON.stringify(event).includes('finished'), false);
});
