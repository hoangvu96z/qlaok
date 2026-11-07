# Qlaok staging

`develop` deploys to `https://qlaok.vunph.io.vn`. `main` continues to use the existing production workflow and production host. Staging uses its own checkout, systemd app, PostgreSQL database, PostgREST listener, and Garage data directory; it does not reuse production records or storage.

## Host layout

- Application: `/var/www/qlaok.vunph.io.vn`
- Runtime environment: `/etc/qlaok-staging/app.env` (also linked as the checkout's ignored `.env.local` for Next.js build-time public variables)
- PostgreSQL: dedicated database `qlaok_staging` on the existing PostgreSQL 14 cluster at the local default socket/port
- App listener: `127.0.0.1:3105`
- PostgREST listener: `127.0.0.1:3106`, routed under `/rest/v1`
- Garage data and listeners: `/var/lib/qlaok-staging/garage`; S3 API on `127.0.0.1:3910`, website on `127.0.0.1:3911`, and admin/RPC APIs loopback-only. Public media is served below `/media/`
- App service: `qlaok-staging.service`; it does not use or save PM2 process state
- Nginx: separate `qlaok.vunph.io.vn` server block in `ops/staging/qlaok-staging.nginx.conf`; validate with `nginx -t` before a graceful reload

The one-node Garage instance is disposable test storage without redundancy. Do not point staging at production PostgreSQL, the production Garage bucket, or production payment callbacks.

## GitHub Actions

`.github/workflows/deploy-staging.yml` verifies the same web/mobile checks as production, then deploys only the exact `develop` commit. Configure these repository Actions secrets before the first deploy:

- `STAGING_SSH_PRIVATE_KEY`: a dedicated Ed25519 key for `qlaok-deploy` (not the root password or a production key)
- `STAGING_SSH_FINGERPRINT`: pinned Ed25519 host fingerprint for `qlaok.vunph.io.vn`

The workflow verifies the fingerprint before opening SSH and never disables host-key checking. The deploy account can only restart the staging systemd unit and run the root-owned staging migration wrapper through `sudo`.

## First-time staging setup checklist

1. Verify DNS for `qlaok.vunph.io.vn` points to the staging VPS.
2. Create the dedicated database, initialize `000_bootstrap.sql` and `public.schema_migrations`, then apply repository migrations with `QLAOK_DB_NAME=qlaok_staging`.
3. Install PostgREST and Garage as separate loopback-only systemd services using `qlaok-staging-postgrest.service` and `qlaok-staging-garage.service`, with generated staging-only credentials and a dedicated Garage bucket. Configure the Garage bucket for website reads so uploaded staging media is public only under the staging hostname.
4. Create `/etc/qlaok-staging/app.env` with a fresh `SESSION_SECRET`, PostgREST JWT secret and role keys, the local database URL, and Garage credentials. Do not copy production secrets into it. Authentication, email and payment integrations need staging-specific provider configuration before those flows can be exercised.
5. Install the three unit files under `/etc/systemd/system/`; install `qlaok-staging-migrate` root-owned at `/usr/local/sbin/qlaok-staging-migrate` and add a narrowly scoped sudoers entry for that wrapper plus `systemctl restart qlaok-staging.service`.
6. Add the dedicated deploy key to `qlaok-deploy`, configure the two GitHub secrets above, then push a verified commit to `develop`.
7. Copy `qlaok-staging.nginx.conf` to `/etc/nginx/sites-available/qlaok.vunph.io.vn`, create the webroot `/var/www/letsencrypt`, enable the single matching vhost, issue its certificate with Certbot's webroot mode, then validate with `nginx -t` and gracefully reload Nginx. The vhost routes the app, `/rest/v1`, `/media`, and order SSE to loopback-only listeners; other vhosts remain unchanged.

The deployment health check verifies the app health route, database realtime triggers, configured storage variables and the order SSE route. It does not prove Zitadel login, SMTP delivery or payment-provider callbacks; those require staging provider accounts and credentials.
