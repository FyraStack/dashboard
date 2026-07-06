# Stack Dashboard

## Usage (dev)

1. `pnpm install`
2. `cd dev`
2. `vyos/build-image.sh`
3. `podman compose up -d`
4. `pve/init-cluster.sh`
5. Copy `apps/dashboard/.env.example` to `apps/dashboard/.env`
6. Add secrets to `apps/dashboard/.env`
  - Update `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` and set all `VPC` stuff to false
  - set `BETTER_AUTH_SECRET` to any value
7. Set up the database: `pnpm --filter stack-dashboard db:migrate`
8. Seed test IPs: `podman exec -i fyra-postgres psql -U postgres < dev/seed-ipam.sql`
9. `pnpm --filter stack-dashboard dev`

Details, one-time machine setup, and caveats: [dev/README.md](dev/README.md)

### secrets

- Required:
  - Generate Better Auth
  - Autumn
  - Postgres connection URL
    - with the dev compose stack: `postgres://postgres:mysecretpassword@127.0.0.1:5432/postgres`
- Highly recommended:
  - Proxmox (printed by `dev/pve/init-cluster.sh`)
- Optional:
  - VyOS (values in [dev/README.md](dev/README.md))
  - GitHub
  - Google
  - Internal cron secret
  - Cloudflare email key
