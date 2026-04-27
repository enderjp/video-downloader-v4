# Deploy guide: DigitalOcean Droplet + Docker Compose + Caddy

This guide deploys this API as a Docker service behind Caddy using a dedicated subdomain.

Assumptions:
- Repo path on droplet: `/projects/apis/video-downloader-v4`
- Global compose stack exists and is where Caddy runs
- Caddy routes are managed via Caddyfile in `/proxies`
- Public domain to use: `api.tudominio.com`

## 1) DNS and folder layout

Create the DNS record:
- `A api.tudominio.com -> <DROPLET_PUBLIC_IP>`

Create folders on droplet:

```bash
mkdir -p /projects/apis/video-downloader-v4
mkdir -p /projects/apis/video-downloader-v4/secrets
mkdir -p /projects/apis/video-downloader-v4/snapshots
```

## 2) Clone and checkout main

```bash
cd /projects/apis
git clone https://github.com/enderjp/video-downloader-v4.git
cd /projects/apis/video-downloader-v4
git checkout main
```

## 3) Create production env file

Use the template from this repo:

```bash
cd /projects/apis/video-downloader-v4
cp .env.production.example .env.production
```

If needed, edit values:

```bash
nano /projects/apis/video-downloader-v4/.env.production
```

Important production defaults:
- `PORT=3000`
- `FACEBOOK_COOKIES_PATH=/run/secrets/facebook-cookies.txt`
- `FACEBOOK_DEBUG_DIR=/app/snapshots`

## 4) Add Facebook cookies as a host secret

```bash
nano /projects/apis/video-downloader-v4/secrets/facebook-cookies.txt
chmod 600 /projects/apis/video-downloader-v4/secrets/facebook-cookies.txt
```

The cookie file must be Netscape format.

## 5) Add service to your global docker-compose

Copy the block from:
- `deploy/docker-compose.global.snippet.yml`

into your global compose file, making sure:
- Service name is `video-downloader-api`
- It joins the same external Docker network as Caddy (`caddy_net`)
- Paths match `/projects/apis/video-downloader-v4`

## 6) Add Caddy route

Copy the block from:
- `deploy/Caddyfile.snippet`

into your Caddyfile under `/proxies` and replace `api.tudominio.com` with your real domain.

## 7) Build and start

From your global compose directory:

```bash
docker compose up -d --build video-downloader-api
```

Reload Caddy:

```bash
docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
```

## 8) Verify deployment

```bash
docker compose logs -f --tail=100 video-downloader-api
curl -i https://api.tudominio.com/health
curl -i https://api.tudominio.com/docs
```

Expected:
- `/health` returns `200` and `{"status":"ok"...}`
- `/docs` loads Swagger UI

## 9) Manual deploy flow for updates

```bash
cd /projects/apis/video-downloader-v4
git pull origin main
cd /<YOUR_GLOBAL_COMPOSE_DIR>
docker compose up -d --build video-downloader-api
docker compose logs --tail=80 video-downloader-api
```

## Acceptance checklist

1. `GET /health` returns `200`.
2. `GET /docs` loads over HTTPS.
3. `POST /api/extract` returns `200` with `sourceUrl` for a valid URL.
4. Extraction failures return controlled JSON (`404` or `502`) without crashing container.
5. Service starts after droplet reboot (`restart: unless-stopped`).
6. `git pull + compose up --build` updates app without changing public endpoints.
