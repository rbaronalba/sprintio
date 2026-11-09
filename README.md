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

## Screenshots

| Board | Card detail |
|---|---|
| ![Board with lists and cards](docs/screenshots/board.jpg) | ![Card detail with checklist](docs/screenshots/card-detail.jpg) |

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

## Tests

```sh
pnpm --filter api test        # unit tests (vitest)
pnpm --filter api test:e2e    # API e2e tests (vitest)
pnpm --filter web test        # unit tests (Angular/Karma)
pnpm --filter web e2e         # browser e2e (Playwright), needs the stack running
```

## Technical decisions

Non-obvious decisions are documented as ADRs in [docs/adr](docs/adr):

- **Board-membership authorization**, not global roles — Trello has no role hierarchy, permission is a person-board relationship ([0001](docs/adr/0001-board-membership-authorization.md)).
- **SSE instead of WebSockets** for realtime updates — every write already goes through REST, so only the server→client direction was missing, and `EventSource` gives that for free with built-in reconnection ([0002](docs/adr/0002-sse-over-websockets.md)).
- **A single event log** feeds realtime, activity and notifications at once, instead of three separate subsystems ([0003](docs/adr/0003-single-event-log.md)).
- **Sparse float positions** for list/card drag-and-drop ordering — a single row is updated per move, instead of rewriting every sibling ([0006](docs/adr/0006-float-positions.md)).

## Project structure

```
apps/
  api/     NestJS backend (auth, boards, cards, lists, events, realtime)
  web/     Angular frontend (boards, dashboard, account, admin)
docs/
  adr/         architecture decision records
  deploy.md    production deployment guide
  screenshots/ README images
docker-compose.yml
Caddyfile
```
