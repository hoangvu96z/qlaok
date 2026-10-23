#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_LOG_DIR = '.agy-runs';
const QUIET_HEARTBEAT_MS = 60_000;
const SECRET_ASSIGNMENT =
  /((?:api[_-]?key|access[_-]?token|refresh[_-]?token|service[_-]?role[_-]?key|token|password|secret|authorization|private[_-]?key)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi;

export function redactSecrets(value) {
  return String(value ?? '')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(
      /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sb_secret_[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9_-]{20,})\b/g,
      '[REDACTED]'
    )
    .replace(SECRET_ASSIGNMENT, '$1[REDACTED]');
}

function getParameter(parameters, names) {
  for (const name of names) {
    const value = parameters?.[name];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function getCheckKind(command) {
  if (!command) return null;
  if (/\b(?:npm run )?build\b|\bnext build\b/i.test(command)) return 'build';
  if (/\btypecheck\b|\btsc\s+--noEmit\b/i.test(command)) return 'typecheck';
  if (/\b(?:npm run )?(?:test|test:[\w:-]+)\b|\bnode\s+--test\b|\bplaywright\s+test\b/i.test(command)) {
    return 'test';
  }
  if (/\blint\b|\beslint\b/i.test(command)) return 'lint';
  if (/\bcodegraph\s+(?:status|sync|explore|node|affected)\b/i.test(command)) {
    return 'codegraph';
  }
  return null;
}

function summarizeCommand(command) {
  if (!command) return null;
  const normalized = command.replace(/\s+/g, ' ').trim();
  const npmScript = normalized.match(/\b(?:npm|pnpm|yarn)\s+run\s+([\w:-]+)/i);
  if (npmScript) return `${normalized.match(/\b(?:npm|pnpm|yarn)\b/i)?.[0]} run ${npmScript[1]}`;
  const codegraph = normalized.match(/\bcodegraph\s+(status|sync|explore|node|affected)\b/i);
  if (codegraph) return `codegraph ${codegraph[1]}`;
  const nodeTest = normalized.match(/\bnode\s+--test\b/i);
  if (nodeTest) return 'node --test';
  const gitCommand = normalized.match(/\bgit\s+(status|diff|show|log|branch|rev-parse)\b/i);
  if (gitCommand) return `git ${gitCommand[1]}`;
  return normalized.split(' ').slice(0, 2).join(' ').slice(0, 120);
}

export function summarizeCheck(command, output = '') {
  const kind = getCheckKind(command);
  if (!kind) return null;

  const text = String(output);
  const counts = {};
  const tapCounts = text.match(/# tests\s+(\d+)\s*\n# pass\s+(\d+)\s*\n# fail\s+(\d+)/i);
  if (tapCounts) {
    counts.tests = Number(tapCounts[1]);
    counts.passed = Number(tapCounts[2]);
    counts.failed = Number(tapCounts[3]);
  } else {
    const jestCounts = text.match(/Tests:\s*(?:(\d+) failed,?\s*)?(?:(\d+) passed)?/i);
    if (jestCounts) {
      if (jestCounts[1]) counts.failed = Number(jestCounts[1]);
      if (jestCounts[2]) counts.passed = Number(jestCounts[2]);
    }
  }

  const exitMatch = text.match(/(?:exit(?:ed)?(?:\s+with)?\s+code|exit code)\s*[:=]?\s*(\d+)/i);
  const explicitExitCode = exitMatch ? Number(exitMatch[1]) : null;
  let outcome = 'unverified';
  if (explicitExitCode !== null) {
    outcome = explicitExitCode === 0 ? 'passed' : 'failed';
  } else if (typeof counts.failed === 'number') {
    outcome = counts.failed === 0 ? 'passed' : 'failed';
  } else if (/\b(command failed|tests? failed|build failed|typecheck failed|error occurred)\b/i.test(text)) {
    outcome = 'failed';
  }

  return {
    kind,
    outcome,
    ...(explicitExitCode !== null ? { exitCode: explicitExitCode } : {}),
    ...(Object.keys(counts).length ? { counts } : {}),
  };
}

export function normalizeAgyEvent(event) {
  if (!event || typeof event !== 'object') return { event: 'unknown' };

  if (event.event === 'init') {
    return {
      event: 'init',
      conversationId: event.conversation_id ?? null,
      model: event.init?.model ?? null,
      permissionMode: event.init?.permission_mode ?? null,
    };
  }

  if (event.event === 'step_update') {
    const step = event.step_update || {};
    const info = step.tool_info || {};
    const parameters = info.parameters || {};
    const toolName = step.tool_name || info.name || null;
    const filePath = getParameter(parameters, [
      'Path', 'FilePath', 'file_path', 'path', 'filename', 'fileName',
    ]);
    const command = getParameter(parameters, [
      'CommandLine', 'command', 'cmd', 'Command',
    ]);
    const output = typeof info.output === 'string' ? info.output : '';
    const check = step.state === 'DONE' ? summarizeCheck(command, output) : null;
    const stepType = step.step_type ?? null;
    const looksLikeWrite =
      stepType === 'tool' && /write|edit|replace|delete|move|create_file/i.test(toolName || '');

    return {
      event: 'step_update',
      conversationId: step.conversation_id ?? event.conversation_id ?? null,
      stepIndex: Number.isInteger(step.step_index) ? step.step_index : null,
      state: step.state ?? null,
      stepType,
      ...(toolName ? { toolName } : {}),
      ...(filePath ? { filePath: redactSecrets(filePath).slice(0, 500) } : {}),
      ...(looksLikeWrite && filePath ? { fileActivity: 'write_or_edit' } : {}),
      ...(command ? { command: redactSecrets(summarizeCommand(command)) } : {}),
      ...(check ? { check } : {}),
      ...(step.text_delta ? { responseDeltaChars: String(step.text_delta).length } : {}),
      ...(typeof step.duration_seconds === 'number'
        ? { durationSeconds: step.duration_seconds }
        : {}),
      ...(step.usage && typeof step.usage === 'object'
        ? { usage: step.usage }
        : {}),
    };
  }

  if (event.event === 'result') {
    const result = event.result || {};
    return {
      event: 'result',
      conversationId: result.conversation_id ?? null,
      status: result.status ?? 'UNKNOWN',
      durationSeconds: result.duration_seconds ?? null,
      turns: result.num_turns ?? null,
      responseChars: typeof result.response === 'string' ? result.response.length : 0,
      ...(result.usage && typeof result.usage === 'object'
        ? { usage: result.usage }
        : {}),
    };
  }

  return { event: typeof event.event === 'string' ? event.event : 'unknown' };
}

function shouldSkipSnapshotPath(filePath) {
  const normalized = filePath.replaceAll('\\', '/');
  return /(^|\/)(?:\.env(?:\.[^/]*)?|\.local-db|node_modules|\.next)(\/|$)/.test(normalized);
}

export function diffSnapshots(before, after) {
  const changed = [];
  const noLongerDirty = [];
  for (const [filePath, digest] of after) {
    if (before.get(filePath) !== digest) changed.push(filePath);
  }
  for (const filePath of before.keys()) {
    if (!after.has(filePath)) noLongerDirty.push(filePath);
  }
  return { changed: changed.sort(), noLongerDirty: noLongerDirty.sort() };
}

function captureGitSnapshot(cwd) {
  try {
    const output = execFileSync(
      'git',
      ['status', '--porcelain=v1', '-z', '--untracked-files=all'],
      { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    );
    const snapshot = new Map();
    for (const record of output.split('\0')) {
      if (record.length < 4) continue;
      const filePath = record.slice(3);
      if (!filePath || shouldSkipSnapshotPath(filePath)) continue;
      const absolutePath = path.join(cwd, filePath);
      let digest = 'missing';
      try {
        const stat = fs.lstatSync(absolutePath);
        digest = stat.isFile()
          ? createHash('sha256').update(fs.readFileSync(absolutePath)).digest('hex')
          : `non-file:${stat.mode}`;
      } catch {
        // A deleted tracked path remains part of the snapshot.
      }
      snapshot.set(filePath, `${record.slice(0, 2)}:${digest}`);
    }
    return snapshot;
  } catch {
    return null;
  }
}

export function parseRunnerArgs(argv) {
  const options = {
    taskFile: null,
    model: null,
    effort: 'high',
    mode: 'accept-edits',
    continueConversation: false,
    conversationId: null,
    logDir: DEFAULT_LOG_DIR,
    agyBin: process.env.AGY_BIN || 'agy',
    help: false,
  };
  const valueFlags = new Map([
    ['--task-file', 'taskFile'],
    ['--model', 'model'],
    ['--effort', 'effort'],
    ['--mode', 'mode'],
    ['--log-dir', 'logDir'],
    ['--agy-bin', 'agyBin'],
    ['--conversation', 'conversationId'],
  ]);

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === '--continue') {
      options.continueConversation = true;
      continue;
    }
    const option = valueFlags.get(arg);
    if (!option) throw new Error(`Unknown runner option: ${arg}`);
    const value = argv[++i];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
    options[option] = value;
  }

  if (options.help) return options;
  if (options.continueConversation && options.conversationId) {
    throw new Error('Use either --continue or --conversation, not both.');
  }
  if (!options.taskFile) throw new Error('Pass --task-file <path>.');
  if (!options.model) throw new Error('Pass --model <agy-model>; choose Flash for small tasks or Argon for difficult tasks.');
  if (!['low', 'medium', 'high', 'xhigh', 'max'].includes(options.effort)) {
    throw new Error('Effort must be low, medium, high, xhigh, or max.');
  }
  if (!['plan', 'accept-edits'].includes(options.mode)) {
    throw new Error('Mode must be plan or accept-edits.');
  }
  return options;
}

export const RUNNER_HELP = `AGY event runner

Usage:
  npm run agy -- --task-file <path> --model <model> [options]

Options:
  --task-file PATH   UTF-8 file containing the scoped task prompt (required)
  --model NAME       AGY model, for example gemini-3.8-flash-high or gemini-4-argon-high
  --effort LEVEL     low|medium|high|xhigh|max (default: high)
  --mode MODE        plan|accept-edits (default: accept-edits)
  --continue         Continue AGY's most recent conversation
  --conversation ID  Continue an exact conversation ID from a prior run
  --log-dir PATH     JSONL run logs (default: .agy-runs, ignored by Git)
  --agy-bin PATH     AGY executable (default: agy or AGY_BIN)
  --help             Show this help

The runner consumes AGY stream-json events, prints activity as it arrives, and
records a redacted event log. It never enables --dangerously-skip-permissions.
`;

function appendRecord(fd, record) {
  fs.writeSync(fd, `${JSON.stringify({ at: new Date().toISOString(), ...record })}\n`);
}

function getStepLabel(step) {
  if (step.stepType === 'tool') {
    const details = step.filePath || step.command;
    return `${step.toolName || 'tool'}${details ? ` — ${details}` : ''}`;
  }
  if (step.stepType === 'agent_response') return 'AGY is drafting a response';
  if (step.stepType === 'user_input') return 'task prompt accepted';
  return step.stepType || 'AGY activity';
}

async function run(options) {
  const cwd = process.cwd();
  const taskPath = path.resolve(cwd, options.taskFile);
  const prompt = fs.readFileSync(taskPath, 'utf8').trim();
  if (!prompt) throw new Error(`Task prompt is empty: ${taskPath}`);

  const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
  const logDirectory = path.resolve(cwd, options.logDir);
  const logDirectoryExisted = fs.existsSync(logDirectory);
  fs.mkdirSync(logDirectory, { recursive: true, mode: 0o700 });
  if (!logDirectoryExisted || logDirectory === path.resolve(cwd, DEFAULT_LOG_DIR)) {
    try {
      fs.chmodSync(logDirectory, 0o700);
    } catch {
      // Some filesystems do not support chmod; keep the run usable.
    }
  }
  const logPath = path.join(logDirectory, `${runId}.jsonl`);
  const logFd = fs.openSync(logPath, 'a', 0o600);
  const before = captureGitSnapshot(cwd);
  const startedAt = Date.now();
  let lastEventAt = startedAt;
  let activeTool = null;
  let finalResult = null;
  let conversationId = null;
  let childError = null;

  const args = [
    ...(options.continueConversation ? ['--continue'] : []),
    ...(options.conversationId ? ['--conversation', options.conversationId] : []),
    '--model', options.model,
    '--effort', options.effort,
    '--mode', options.mode,
    '--output-format', 'stream-json',
    '--print', prompt,
  ];

  appendRecord(logFd, {
    kind: 'run_started',
    runId,
    model: options.model,
    effort: options.effort,
    mode: options.mode,
    taskFile: path.relative(cwd, taskPath),
    logFile: path.relative(cwd, logPath),
    baselineFiles: before ? [...before.keys()].sort() : null,
  });
  console.log(`AGY run ${runId} started · ${options.model} · ${options.effort} · ${options.mode}`);
  console.log(`Event log: ${path.relative(cwd, logPath)}`);

  const child = spawn(options.agyBin, args, {
    cwd,
    env: process.env,
    stdio: ['inherit', 'pipe', 'pipe'],
  });

  const stdout = child.stdout ? createInterface({ input: child.stdout }) : null;
  stdout?.on('line', (line) => {
    lastEventAt = Date.now();
    let raw;
    try {
      raw = JSON.parse(line);
    } catch {
      const safeLine = redactSecrets(line).slice(0, 500);
      appendRecord(logFd, { kind: 'unparsed_output', charCount: line.length });
      if (safeLine) console.log(`AGY emitted non-JSON output (${line.length} chars): ${safeLine}`);
      return;
    }

    const normalized = normalizeAgyEvent(raw);
    if (normalized.event === 'init') conversationId = normalized.conversationId;
    if (normalized.event === 'result') {
      finalResult = normalized;
      const response = raw.result?.response;
      rawResponseForDisplay = typeof response === 'string' ? response : '';
    }
    if (normalized.event === 'step_update') {
      if (normalized.stepType === 'tool') {
        activeTool = normalized.state === 'ACTIVE' ? normalized.toolName : null;
      }
    }

    appendRecord(logFd, { kind: 'agy_event', runId, ...normalized });

    if (normalized.event === 'init') {
      console.log(`AGY connected · conversation ${normalized.conversationId || 'unknown'}`);
    } else if (normalized.event === 'step_update') {
      if (normalized.stepType === 'tool') {
        const state = normalized.state === 'ACTIVE' ? 'started' : 'finished';
        console.log(`AGY tool ${state} · ${getStepLabel(normalized)}`);
      } else if (normalized.stepType === 'agent_response' && normalized.state === 'DONE') {
        console.log('AGY response ready');
      }
      if (normalized.check) {
        console.log(
          `AGY check · ${normalized.check.kind}: ${normalized.check.outcome}` +
            (normalized.check.counts ? ` · ${JSON.stringify(normalized.check.counts)}` : '')
        );
      }
    } else if (normalized.event === 'result') {
      console.log(`AGY result event · ${normalized.status} · ${normalized.durationSeconds ?? '?'}s`);
    }
  });

  const stderr = child.stderr ? createInterface({ input: child.stderr }) : null;
  stderr?.on('line', (line) => {
    lastEventAt = Date.now();
    const safeLine = redactSecrets(line).slice(0, 1000);
    appendRecord(logFd, { kind: 'agy_stderr', runId, charCount: line.length });
    if (safeLine) console.error(`AGY: ${safeLine}`);
  });

  const heartbeat = child.pid ? setInterval(() => {
    const quietSeconds = Math.floor((Date.now() - lastEventAt) / 1000);
    const waitingFor = activeTool ? `tool ${activeTool}` : 'AGY event (model/CLI may be processing or waiting for input)';
    const record = { kind: 'quiet_interval', runId, quietSeconds, waitingFor };
    appendRecord(logFd, record);
    console.log(`AGY still active · no event for ${quietSeconds}s · ${waitingFor}`);
  }, QUIET_HEARTBEAT_MS) : null;
  heartbeat?.unref();

  let closeProcess;
  const processClosed = new Promise((resolve) => {
    closeProcess = resolve;
  });
  child.on('error', (error) => {
    childError = error;
    closeProcess(1);
  });
  child.once('close', (code) => closeProcess(code ?? 1));
  const exitCode = await processClosed;
  if (heartbeat) clearInterval(heartbeat);

  const after = captureGitSnapshot(cwd);
  const fileDelta = before && after ? diffSnapshots(before, after) : null;
  const processExitCode = Number.isInteger(exitCode) && exitCode >= 0 ? exitCode : 1;
  const successful = processExitCode === 0 && finalResult?.status === 'SUCCESS';
  const finalStatus = successful
    ? 'SUCCESS'
    : finalResult?.status && finalResult.status !== 'SUCCESS'
      ? finalResult.status
      : childError
        ? 'SPAWN_ERROR'
        : 'INCOMPLETE';
  const durationSeconds = Math.round((Date.now() - startedAt) / 1000);

  if (fileDelta) {
    appendRecord(logFd, { kind: 'worktree_delta', runId, ...fileDelta });
    console.log(
      `AGY file changes · ${fileDelta.changed.length} changed` +
        (fileDelta.changed.length ? `: ${fileDelta.changed.join(', ')}` : '')
    );
    if (fileDelta.noLongerDirty.length) {
      console.log(`Previously dirty files now clean · ${fileDelta.noLongerDirty.join(', ')}`);
    }
  } else {
    appendRecord(logFd, { kind: 'worktree_delta_unavailable', runId });
  }

  appendRecord(logFd, {
    kind: 'run_finished',
    runId,
    status: finalStatus,
    processExitCode,
    durationSeconds,
    conversationId,
    resultStatus: finalResult?.status ?? null,
    usage: finalResult?.usage ?? null,
  });
  fs.closeSync(logFd);
  console.log(`AGY run ${finalStatus} · ${durationSeconds}s · ${path.relative(cwd, logPath)}`);
  if (finalResult?.usage) console.log(`Usage · ${JSON.stringify(finalResult.usage)}`);

  const response = finalResult && typeof rawResponseForDisplay === 'string'
    ? rawResponseForDisplay
    : '';
  if (response.trim()) {
    console.log('\nAGY final response:\n');
    console.log(redactSecrets(response).trim());
  }
  return successful ? 0 : processExitCode === 0 ? 1 : processExitCode;
}

let rawResponseForDisplay = '';

async function main() {
  let options;
  try {
    options = parseRunnerArgs(process.argv.slice(2));
    if (options.help) {
      console.log(RUNNER_HELP);
      return 0;
    }
    return await run(options);
  } catch (error) {
    console.error(redactSecrets(error?.message || error));
    console.error(RUNNER_HELP);
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = await main();
}
