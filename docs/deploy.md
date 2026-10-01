# Deploying Sprintio

One Linux server with Docker. Everything runs from `docker-compose.yml`.

## 1. `.env` next to `docker-compose.yml`

```env
POSTGRES_PASSWORD=<letters and digits only, long>
JWT_SECRET=<openssl rand -hex 32>
DOMAIN=sprintio.example.com
WEB_ORIGIN=https://sprintio.example.com
ADMIN_EMAILS=you@example.com

# Optional
MICROSOFT_CLIENT_ID=
MICROSOFT_CLIENT_SECRET=
MICROSOFT_TENANT_ID=
SMTP_URL=smtp://user:password@smtp.office365.com:587
MAIL_FROM=Sprintio <sprintio@example.com>
BACKUP_DIR=/srv/sprintio-backups
```

`WEB_ORIGIN` must be exactly the URL people type, with `https://`. With Microsoft
configured, register `<WEB_ORIGIN>/auth/microsoft/callback` as the redirect URI in Azure.
Password self-registration is then disabled: everyone signs in with their company account.

## 2. Certificate

- **Public DNS name, ports 80 and 443 open to the internet:** nothing to do. Caddy gets a
  Let's Encrypt certificate and renews it.
- **Internal name only:** copy the company certificate (full chain) and key to
  `certs/cert.pem` and `certs/key.pem`, and uncomment the `tls` line in `Caddyfile`.

## 3. Start and update

```sh
docker compose --profile prod up -d --build
```

This command both starts and updates the app. Database migrations run on their own (the
`migrate` service) before the api starts. All services come back up after a server reboot.

If a company proxy terminates TLS instead of Caddy, leave out `--profile prod`, expose the
`web` port to that proxy only, and turn off its response buffering for `/events/stream`.

## 4. Backups

The `backup` service writes into `BACKUP_DIR` every 24 h, and deletes files older than 14 days:

- `db-YYYY-MM-DD.dump`: the database
- `uploads-YYYY-MM-DD.tar.gz`: attachments and backgrounds

They sit on the same disk as the app, so copy `BACKUP_DIR` to another machine (rsync, a
NAS, whatever IT backs up). Check that it works with `docker compose logs backup`, which
prints `backup <date> ok` every night.

### Restore

```sh
docker compose stop api
docker compose exec -T db pg_restore -U sprintio -d sprintio --clean --if-exists < backups/db-2026-10-01.dump
docker compose run --rm --no-deps -v "$PWD/backups:/backups" --entrypoint sh api \
  -c 'tar xzf /backups/uploads-2026-10-01.tar.gz -C /app/uploads'
docker compose start api
```

Use `$BACKUP_DIR` in place of `$PWD/backups` if you changed it.
