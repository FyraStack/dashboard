# Stack Dashboard

## Usage (dev)

1. `pnpm install`
2. `cd dev`
2. `vyos/build-image.sh`
3. `podman compose up -d`
4. `pve/init-cluster.sh`
5. Copy `apps/backend/.env.example` to `apps/backend/.env`
6. Add secrets to `apps/backend/.env`
  - Set `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` and set all `VPC` stuff to false
  - set `BETTER_AUTH_SECRET` to any value
7. Set up the database: `pnpm --filter stack-backend db:migrate`
8. Seed test IPs: `podman exec -i fyra-postgres psql -U postgres < dev/seed-ipam.sql`
9. `pnpm dev` (runs the backend worker on port 5174 and the dashboard on 5173; the dashboard reaches the backend through the `BACKEND` service binding, so both must be running)

## Deploying

`pnpm cf:deploy` builds everything, deploys `stack-backend`, then `stack-dashboard` (the dashboard's service binding needs the backend to exist first). `pnpm cf:deploy:preview` does the same for the preview environments.

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
  - Cloudflare email key
  - Bunny.net API key
