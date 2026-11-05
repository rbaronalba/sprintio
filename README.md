# Sprintio

A self-hosted Trello-style project management tool: workspaces, boards, lists and cards, with realtime updates, comments, attachments, time tracking and notifications.

## Stack

- **apps/web** — Angular 18 frontend
- **apps/api** — NestJS backend, Prisma + PostgreSQL, Redis (realtime/pubsub)
- **Caddy** — reverse proxy + automatic HTTPS in production
- Everything runs via `docker-compose.yml`

## Features

- Workspaces, boards, lists, cards, drag-and-drop
- Checklists, labels, comments, attachments, card archiving
- Time tracking per card
- Starred boards, custom board backgrounds
- Realtime updates and notifications (SSE)
- Auth: email/password or Microsoft sign-in (Azure AD), user admin panel
- Email notifications (SMTP)

## Local development

```sh
pnpm install
pnpm --filter api start:dev   # http://localhost:3000
pnpm --filter web start       # http://localhost:4200
```

The API needs Postgres and Redis running (see `docker-compose.yml` for the `db` and `redis` services, or point `DATABASE_URL`/`REDIS_URL` at your own).

## Production deployment

One Linux server with Docker handles everything:

```sh
docker compose --profile prod up -d --build
```

See [docs/deploy.md](docs/deploy.md) for environment variables, HTTPS/certificate setup, and backup/restore.

## Project structure

```
apps/
  api/     NestJS backend (auth, boards, cards, lists, events, realtime)
  web/     Angular frontend (boards, dashboard, account, admin)
docs/
  adr/         architecture decision records
  deploy.md    production deployment guide
docker-compose.yml
Caddyfile
```
