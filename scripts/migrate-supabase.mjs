import fs from 'node:fs';
import path from 'node:path';

/**
 * Automated Supabase SQL Migration Runner for Qlaok
 * Usage: npm run db:migrate
 *
 * Supports:
 * 1. SUPABASE_ACCESS_TOKEN (Personal Access Token from https://supabase.com/dashboard/account/tokens)
 *    -> Executes all supabase/migrations/*.sql via Supabase Management API over HTTPS
 * 2. rpc('exec_sql') via SUPABASE_SERVICE_ROLE_KEY (if exec_sql function was created once)
 */

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eqIdx = line.indexOf('=');
    if (eqIdx === -1) continue;
    const key = line.slice(0, eqIdx).trim();
    let val = line.slice(eqIdx + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) {
      process.env[key] = val;
    }
  }
}

loadEnvFile(path.join(process.cwd(), '.env.local'));
loadEnvFile(path.join(process.cwd(), '.env'));

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

function extractProjectRef(url) {
  const match = url.match(/https?:\/\/([a-z0-9-]+)\.supabase\.co/i);
  return match ? match[1] : process.env.SUPABASE_PROJECT_REF || '';
}

async function runSqlViaManagementApi(projectRef, accessToken, sql, fileName) {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: sql }),
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`HTTP ${res.status} on ${fileName}: ${errText}`);
  }
  return await res.json();
}

async function runSqlViaRpc(supabaseUrl, serviceKey, sql, fileName) {
  const res = await fetch(`${supabaseUrl.replace(/\/$/, '')}/rest/v1/rpc/exec_sql`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`RPC exec_sql HTTP ${res.status} on ${fileName}: ${errText}`);
  }
}

async function main() {
  const migrationsDir = path.join(process.cwd(), 'supabase', 'migrations');
  if (!fs.existsSync(migrationsDir)) {
    console.log('No supabase/migrations directory found.');
    return;
  }

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  if (files.length === 0) {
    console.log('No .sql migration files found in supabase/migrations.');
    return;
  }

  const projectRef = extractProjectRef(SUPABASE_URL);

  console.log(`Found ${files.length} SQL migration(s):`, files.join(', '));

  if (SUPABASE_ACCESS_TOKEN && projectRef) {
    console.log(
      `🚀 Running migrations automatically on Supabase project "${projectRef}" via Management API...`
    );
    for (const file of files) {
      const fullPath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(fullPath, 'utf8');
      process.stdout.write(`  -> Applying ${file}... `);
      await runSqlViaManagementApi(
        projectRef,
        SUPABASE_ACCESS_TOKEN,
        sql,
        file
      );
      console.log('DONE ✅');
    }
    console.log('🎉 All SQL migrations applied to Supabase successfully!');
    return;
  }

  if (SUPABASE_SERVICE_ROLE_KEY && SUPABASE_URL) {
    console.log(
      `🚀 Running migrations via Supabase RPC exec_sql on ${SUPABASE_URL}...`
    );
    for (const file of files) {
      const fullPath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(fullPath, 'utf8');
      process.stdout.write(`  -> Applying ${file}... `);
      await runSqlViaRpc(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, sql, file);
      console.log('DONE ✅');
    }
    console.log('🎉 All SQL migrations applied to Supabase successfully!');
    return;
  }

  console.log('\n⚠️  Chưa tìm thấy SUPABASE_ACCESS_TOKEN trong .env.local.');
  console.log(
    'Để tự động chạy mọi file SQL trong supabase/migrations/*.sql chỉ với 1 lệnh "npm run db:migrate":'
  );
  console.log(
    '  1. Vào https://supabase.com/dashboard/account/tokens tạo 1 Personal Access Token (sbp_...)'
  );
  console.log(
    '  2. Thêm dòng sau vào file .env.local:\n     SUPABASE_ACCESS_TOKEN=sbp_xxxxxxxxxxxxxxxxxxxx'
  );
  console.log(
    '  3. Chạy lệnh: npm run db:migrate (tự động đẩy toàn bộ file .sql lên Supabase!)\n'
  );
}

main().catch((err) => {
  console.error('\n❌ Migration failed:', err.message);
  process.exit(1);
});
