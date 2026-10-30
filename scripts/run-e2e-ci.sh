#!/usr/bin/env bash
set -Eeuo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_dir"

db_container="qlaok-e2e-postgres-$$"
postgrest_container="qlaok-e2e-postgrest-$$"
next_pid=""
next_log="$(mktemp /tmp/qlaok-e2e-next.XXXXXX)"
db_password="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64url"))')"
jwt_secret="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(48).toString("base64url"))')"
session_secret="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(48).toString("base64url"))')"
db_name="qlaok_e2e"
db_port=""
postgrest_port="18080"

cleanup() {
  if [[ -n "$next_pid" ]]; then
    kill "$next_pid" >/dev/null 2>&1 || true
    wait "$next_pid" >/dev/null 2>&1 || true
  fi
  docker rm -f "$postgrest_container" "$db_container" >/dev/null 2>&1 || true
  rm -f "$next_log"
}
trap cleanup EXIT

docker run -d \
  --name "$db_container" \
  -e POSTGRES_DB="$db_name" \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD="$db_password" \
  -p 127.0.0.1::5432 \
  postgres:14 -c wal_level=logical >/dev/null

for attempt in $(seq 1 60); do
  if docker exec "$db_container" pg_isready -U postgres -d "$db_name" >/dev/null 2>&1; then
    break
  fi
  if [[ "$attempt" == 60 ]]; then
    echo "Disposable PostgreSQL did not become ready." >&2
    exit 1
  fi
  sleep 1
done

db_port="$(docker port "$db_container" 5432/tcp | sed 's/.*://')"
if [[ ! "$db_port" =~ ^[0-9]+$ ]]; then
  echo "Could not determine the disposable PostgreSQL port." >&2
  exit 1
fi

docker exec -i "$db_container" psql -X -v ON_ERROR_STOP=1 -U postgres -d "$db_name" -f - \
  < supabase/self-hosted/000_bootstrap.sql
for migration in supabase/migrations/*.sql; do
  echo "Applying disposable E2E migration: ${migration##*/}"
  docker exec -i "$db_container" psql -X -v ON_ERROR_STOP=1 -U postgres -d "$db_name" -f - \
    < "$migration"
done

docker run -d \
  --name "$postgrest_container" \
  --network host \
  -e PGRST_DB_URI="postgres://postgres:${db_password}@127.0.0.1:${db_port}/${db_name}" \
  -e PGRST_DB_SCHEMAS=public \
  -e PGRST_DB_ANON_ROLE=anon \
  -e PGRST_DB_POOL=10 \
  -e PGRST_JWT_SECRET="$jwt_secret" \
  -e PGRST_SERVER_PORT="$postgrest_port" \
  postgrest/postgrest:v12.2.12 >/dev/null

postgrest_ready=0
for attempt in $(seq 1 60); do
  if curl --silent --show-error --fail --max-time 2 \
    "http://127.0.0.1:${postgrest_port}/" >/dev/null; then
    postgrest_ready=1
    break
  fi
  sleep 1
done
if [[ "$postgrest_ready" != 1 ]]; then
  echo "Disposable PostgREST did not become ready." >&2
  exit 1
fi

make_postgrest_jwt() {
  E2E_TOKEN_ROLE="$1" PGRST_JWT_SECRET="$jwt_secret" node --input-type=module -e '
    import { createHmac } from "node:crypto";
    const role = process.env.E2E_TOKEN_ROLE;
    const secret = process.env.PGRST_JWT_SECRET;
    const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const now = Math.floor(Date.now() / 1000);
    const unsigned = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ role, iat: now, exp: now + 3600 })}`;
    process.stdout.write(`${unsigned}.${createHmac("sha256", secret).update(unsigned).digest("base64url")}`);
  '
}

export TEST_BASE_URL="http://127.0.0.1:3000"
export E2E_ALLOW_MUTATIONS=1
export E2E_DISPOSABLE_DATABASE=1
export ENABLE_DEMO_LOGIN=true
export PAYMENT_DEV_SIMULATE=true
export SESSION_SECRET="$session_secret"
export QLAOK_DB_NAME="$db_name"
export QLAOK_DATABASE_URL="postgres://postgres:${db_password}@127.0.0.1:${db_port}/${db_name}"
export PGRST_JWT_SECRET="$jwt_secret"
export NEXT_PUBLIC_SUPABASE_URL="http://127.0.0.1:${postgrest_port}"
export NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="$(make_postgrest_jwt anon)"
export NEXT_PUBLIC_SUPABASE_ANON_KEY="$NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"
export SUPABASE_SERVICE_ROLE_KEY="$(make_postgrest_jwt service_role)"

./node_modules/.bin/next dev --hostname 127.0.0.1 --port 3000 >"$next_log" 2>&1 &
next_pid=$!
next_ready=0
for attempt in $(seq 1 90); do
  if curl --silent --show-error --fail --max-time 2 \
    "${TEST_BASE_URL}/api/health" >/dev/null; then
    next_ready=1
    break
  fi
  if ! kill -0 "$next_pid" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
if [[ "$next_ready" != 1 ]]; then
  echo "Disposable Next.js test server did not become ready; recent output follows." >&2
  tail -n 80 "$next_log" >&2
  exit 1
fi

npm run test:e2e
