#!/usr/bin/env bash
set -Eeuo pipefail

deployment_sha="${1:-}"
if [[ ! "$deployment_sha" =~ ^[0-9a-f]{40}$ ]]; then
  printf 'Expected a full lowercase commit SHA.\n' >&2
  exit 2
fi

app_root='/var/www/qlaok.vunph.io.vn'
cd "$app_root"

git fetch --no-tags origin develop
git cat-file -e "${deployment_sha}^{commit}"
if ! git merge-base --is-ancestor "$deployment_sha" origin/develop; then
  printf 'Requested commit is not reachable from origin/develop.\n' >&2
  exit 2
fi
git reset --hard "$deployment_sha"

export PATH="/opt/qlaok-staging/node/bin:$PATH"
npm ci --no-audit --no-fund
npm run build

sudo -n /usr/local/sbin/qlaok-staging-migrate
sudo -n /usr/bin/systemctl restart qlaok-staging.service

for attempt in $(seq 1 30); do
  if curl --silent --show-error --fail --max-time 3 \
    http://127.0.0.1:3105/api/health >/dev/null; then
    break
  fi
  if [[ "$attempt" == 30 ]]; then
    printf 'Staging health endpoint did not become ready.\n' >&2
    exit 1
  fi
  sleep 2
done

PORT=3105 node scripts/check-order-realtime.mjs
printf 'Deployed %s to qlaok.vunph.io.vn\n' "$(git rev-parse HEAD)"
