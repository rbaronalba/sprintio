# syntax=docker/dockerfile:1
FROM node:26-alpine AS base
# Node 25+ no longer ships corepack; keep in sync with packageManager in package.json
RUN npm install -g pnpm@12.3.4

FROM base AS build
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY apps/api/package.json apps/api/package.json
RUN pnpm install --frozen-lockfile
COPY apps/web apps/web
RUN pnpm --filter web run build

FROM nginx:alpine AS runtime
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY apps/web/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=build /repo/apps/web/dist/sprintio/browser /usr/share/nginx/html
EXPOSE 80
