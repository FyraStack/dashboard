# Stack Dashboard

## Install

1. `pnpm install`

2. Start a Postgres server:

    - `podman run -p 5432:5432 -e POSTGRES_PASSWORD=mysecretpassword -d postgres`
    - If you want the data to persist:
        - `podman volume create postgres_volume`
        - `podman run -p 5432:5432 --replace --name dashboard_postgres -e POSTGRES_PASSWORD=mysecretpassword -v postgres_volume:/var/lib/postgresql -d postgres`
    - More detailed guide: https://orm.drizzle.team/docs/guides/postgresql-local-setup

3. Add secrets to `.env`:

    - Required:
        - Generate Better Auth
        - Autumn
        - Postgres connection URL
    - Highly recommended:
        - Proxmox
    - Optional:
        - VyOS
        - GitHub
        - Google
        - Billing meter secret
        - Cloudflare email key

4. Set up the database:

    - `pnpm --filter stack-dashboard db:push`

## Usage (dev)

```sh
pnpm dev
```
