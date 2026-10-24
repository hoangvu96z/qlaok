#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REQUIRED_PROJECT_REF, redactSecrets } from './backup-qlaok-db.mjs';
import { executeDemoPublicReset } from './demo-reset-public-runner.mjs';

/**
 * Help text for demo public reset CLI.
 * Explains that this resets ONLY public app data, preserves auth.users/storage/R2,
 * and requires quiet order/webhook traffic.
 */
export const RESET_HELP_TEXT = `
Usage:
  QLAOK_DATABASE_URL=... node --experimental-strip-types --import ./tests/register-ts.mjs scripts/reset-demo-public.mjs \\
    --project-ref ${REQUIRED_PROJECT_REF} \\
    --execute \\
    --maintenance-confirmed \\
    [--backup-output-dir <path>]

Description:
  Guarded CLI to execute the demo public database reset.
  - Resets ONLY public app data (deletes operational rows and seeds owner demo data).
  - Preserves auth.users, Supabase storage, Cloudflare R2 assets, and schema_migrations.
  - Requires quiet order and webhook traffic (e.g., Sepay webhooks). Maintenance must be confirmed.

Options:
  --project-ref <ref>         Exact target project ref ('${REQUIRED_PROJECT_REF}') [required]
  --execute                   Explicit execution confirmation flag [required]
  --maintenance-confirmed     Explicit maintenance window confirmation flag [required]
  --backup-output-dir <path>  Optional output directory for pre-reset database backup
  --help, -h                  Show this help message
`.trim();

/**
 * Parses and strictly validates CLI arguments for reset-demo-public.
 * Rejects missing flags and any unknown option without echoing raw input.
 * Never accepts database URLs via CLI.
 *
 * @param {string[]} [argv=[]]
 * @returns {{
 *   help?: boolean,
 *   projectRef?: string,
 *   execute?: boolean,
 *   maintenanceConfirmed?: boolean,
 *   backupOutputDir?: string
 * }}
 */
export function parseResetArgs(argv = []) {
  let projectRef = '';
  let execute = false;
  let maintenanceConfirmed = false;
  let backupOutputDir;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === '--help' || arg === '-h') {
      return { help: true };
    }

    if (/^(postgres|postgresql):\/\//i.test(arg) || arg.startsWith('--db') || arg.startsWith('--url')) {
      throw new Error('Database URL must never be passed via CLI arguments.');
    }

    if (arg === '--project-ref') {
      i++;
      if (i >= argv.length) {
        throw new Error(`--project-ref is required and must be exact '${REQUIRED_PROJECT_REF}'.`);
      }
      projectRef = argv[i];
    } else if (arg.startsWith('--project-ref=')) {
      projectRef = arg.slice(14);
    } else if (arg === '--execute') {
      execute = true;
    } else if (arg === '--maintenance-confirmed') {
      maintenanceConfirmed = true;
    } else if (arg === '--backup-output-dir') {
      i++;
      if (i >= argv.length) {
        throw new Error('--backup-output-dir requires a valid path.');
      }
      const dirVal = argv[i];
      if (!dirVal || dirVal.startsWith('--')) {
        throw new Error('--backup-output-dir requires a valid path.');
      }
      backupOutputDir = dirVal;
    } else if (arg.startsWith('--backup-output-dir=')) {
      const dirVal = arg.slice(20);
      if (!dirVal) {
        throw new Error('--backup-output-dir requires a valid path.');
      }
      backupOutputDir = dirVal;
    } else {
      // Reject any other option without echoing raw input (which could be a secret)
      throw new Error('Unknown option provided. Database credentials and unrecognized arguments must not be passed via CLI.');
    }
  }

  if (!projectRef) {
    throw new Error(`--project-ref is required and must be exact '${REQUIRED_PROJECT_REF}'.`);
  }
  if (projectRef !== REQUIRED_PROJECT_REF) {
    throw new Error(`--project-ref is required and must be exact '${REQUIRED_PROJECT_REF}'.`);
  }

  if (!execute) {
    throw new Error('--execute is required to run public demo reset.');
  }

  if (!maintenanceConfirmed) {
    throw new Error('--maintenance-confirmed is required to run public demo reset.');
  }

  const result = {
    projectRef,
    execute,
    maintenanceConfirmed,
  };

  if (backupOutputDir !== undefined) {
    result.backupOutputDir = backupOutputDir;
  }

  return result;
}

/**
 * Runs the guarded demo public reset CLI workflow.
 *
 * @param {string[]} [argv=process.argv.slice(2)]
 * @param {Record<string, string | undefined>} [env=process.env]
 * @param {{
 *   executeDemoPublicReset?: typeof executeDemoPublicReset
 * }} [deps={}]
 * @returns {Promise<{ backupPath: string, backupSize: number, tableCounts: Record<string, number> } | undefined>}
 */
export async function runResetCli(argv = process.argv.slice(2), env = process.env, deps = {}) {
  const parsed = parseResetArgs(argv);
  if (parsed.help) {
    console.log(RESET_HELP_TEXT);
    return;
  }

  const executeFn = deps.executeDemoPublicReset || executeDemoPublicReset;
  const result = await executeFn(parsed, env, deps);

  const output = {
    backupPath: result.backupPath,
    backupSize: result.backupSize,
    tableCounts: result.tableCounts,
  };

  console.log(JSON.stringify(output, null, 2));
  return output;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runResetCli()
    .then(() => {
      process.exit(0);
    })
    .catch((err) => {
      console.error(`❌ Reset failed: ${redactSecrets(err?.message || 'Unknown error')}`);
      process.exit(1);
    });
}
