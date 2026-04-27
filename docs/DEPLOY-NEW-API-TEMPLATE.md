# New API deploy template (Droplet + Docker + Caddy)

Use this when deploying any new API to the same droplet.

## 1) Create folders

```bash
mkdir -p /srv/<api-folder>/<repo-name>
mkdir -p /srv/<api-folder>/<repo-name>/secrets
mkdir -p /srv/<api-folder>/<repo-name>/snapshots
```

## 2) Clone and prepare env

```bash
cd /srv/<api-folder>
git clone <repo-url>.git
cd <repo-name>
cp deploy/templates/.env.production.template .env.production
nano .env.production
```

Set at least:
- `COOKIE_ADMIN_TOKEN` with a long random secret
- `COOKIE_AUDIT_LOG_PATH` to a persistent path (example `/app/snapshots/cookie-rotation.audit.jsonl`)

## 3) Create secret file

```bash
nano /srv/<api-folder>/<repo-name>/secrets/<secret-file-name>
chmod 600 /srv/<api-folder>/<repo-name>/secrets/<secret-file-name>
```

## 4) Add Docker service

Copy:
- `deploy/templates/docker-compose.api.template.yml`

Replace:
- `<api-service-name>` example: `api-orders`
- `<repo-absolute-path>` example: `/srv/api-orders/orders-service`
- `<secret-file-name>` example: `facebook-cookies.txt`

Important:
- Keep cookie secret mount writable (no `:ro`) if API supports cookie rotation endpoint.

Run:

```bash
docker compose config
docker compose up -d --build <api-service-name>
docker compose logs --tail=100 <api-service-name>
```

## 5) Add Caddy route

Copy:
- `deploy/templates/Caddyfile.api.template`

Replace:
- `<public-hostname>` example: `orders.api.137-184-149-94.sslip.io`
- `<api-service-name>` same as compose service name

Reload Caddy:

```bash
docker exec vendor-dashboard-caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
```

## 6) Validate endpoint

```bash
curl -i https://<public-hostname>/health
curl -i https://<public-hostname>/docs
```

## 7) Update flow (next deploys)

```bash
cd /srv/<api-folder>/<repo-name>
git pull origin main
docker compose up -d --build <api-service-name>
docker compose logs --tail=80 <api-service-name>
```

## Minimal rules

1. Keep unique service names in compose.
2. Keep all APIs + Caddy in Docker network `web`.
3. Prefer `expose` instead of `ports`.
4. Use absolute host paths in `volumes`.
5. Keep secrets outside git.
