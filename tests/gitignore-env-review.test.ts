import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

function runGitCheckIgnore(paths: string[], extraArgs: string[] = []): {
  status: number | null;
  stdout: string;
  stderr: string;
} {
  const result = spawnSync('git', ['check-ignore', '--no-index', ...extraArgs, ...paths], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

const REPRESENTATIVE_IGNORED_ROOT_ENV_FILES = [
  '.env',
  '.env.local',
  '.env.production',
  '.env.staging',
  '.env.production.local',
  '.env.testing',
  '.env.development',
  '.env.development.local',
  '.env.test',
  '.env.test.local',
];

const REPRESENTATIVE_IGNORED_MOBILE_ENV_FILES = [
  'mobile/.env',
  'mobile/.env.local',
  'mobile/.env.production',
  'mobile/.env.staging',
  'mobile/.env.production.local',
  'mobile/.env.testing',
  'mobile/.env.development',
  'mobile/.env.development.local',
  'mobile/.env.test',
  'mobile/.env.test.local',
];

const TRACKABLE_EXAMPLE_FILES = [
  '.env.example',
  'mobile/.env.example',
];

test('.gitignore ignores root environment-specific files', () => {
  for (const envPath of REPRESENTATIVE_IGNORED_ROOT_ENV_FILES) {
    const { status, stdout, stderr } = runGitCheckIgnore([envPath]);
    assert.equal(status, 0, `Expected ${envPath} to be ignored. stderr: ${stderr}`);
    assert.equal(stdout.trim(), envPath);
  }
});

test('.gitignore ignores mobile environment-specific files', () => {
  for (const envPath of REPRESENTATIVE_IGNORED_MOBILE_ENV_FILES) {
    const { status, stdout, stderr } = runGitCheckIgnore([envPath]);
    assert.equal(status, 0, `Expected ${envPath} to be ignored. stderr: ${stderr}`);
    assert.equal(stdout.trim(), envPath);
  }
});

test('.gitignore keeps .env.example and mobile/.env.example trackable', () => {
  for (const examplePath of TRACKABLE_EXAMPLE_FILES) {
    const { status, stdout } = runGitCheckIgnore([examplePath]);
    assert.equal(status, 1, `Expected ${examplePath} to NOT be ignored`);
    assert.equal(stdout.trim(), '');
  }
});

test('git check-ignore batch invocation distinguishes env files from example files', () => {
  const allPaths = [
    ...REPRESENTATIVE_IGNORED_ROOT_ENV_FILES,
    ...REPRESENTATIVE_IGNORED_MOBILE_ENV_FILES,
    ...TRACKABLE_EXAMPLE_FILES,
  ];
  const { status, stdout, stderr } = runGitCheckIgnore(allPaths);
  assert.equal(status, 0, `Expected batch check to succeed. stderr: ${stderr}`);

  const outputLines = stdout.trim().split('\n').filter(Boolean);
  const expectedIgnored = [
    ...REPRESENTATIVE_IGNORED_ROOT_ENV_FILES,
    ...REPRESENTATIVE_IGNORED_MOBILE_ENV_FILES,
  ];

  assert.deepEqual(outputLines, expectedIgnored);
  assert.ok(!outputLines.includes('.env.example'), '.env.example must not be ignored');
  assert.ok(!outputLines.includes('mobile/.env.example'), 'mobile/.env.example must not be ignored');
});

test('git check-ignore -v reports matched ignore and unignore rules', () => {
  const { status, stdout, stderr } = runGitCheckIgnore(
    ['.env.production', 'mobile/.env.production', '.env.example', 'mobile/.env.example'],
    ['-v']
  );
  assert.equal(status, 0, `Expected verbose check to succeed. stderr: ${stderr}`);

  const lines = stdout.trim().split('\n');
  assert.equal(lines.length, 4);

  // Root and mobile production envs match .env.*
  assert.match(lines[0], /^\.gitignore:\d+:\.env\.\*\t\.env\.production$/);
  assert.match(lines[1], /^\.gitignore:\d+:\.env\.\*\tmobile\/\.env\.production$/);

  // Both example files match negation pattern !.env.example
  assert.match(lines[2], /^\.gitignore:\d+:!\.env\.example\t\.env\.example$/);
  assert.match(lines[3], /^\.gitignore:\d+:!\.env\.example\tmobile\/\.env\.example$/);
});
