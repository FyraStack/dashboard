# Local Dev Stack

Postgres, VyOS, and a 3-node Proxmox HA cluster in containers.

## One-time machine setup (Linux)

```sh
sudo dnf install podman podman-compose wireguard-tools
printf 'fs.inotify.max_user_instances=512\nfs.inotify.max_user_watches=1048576\n' | sudo tee /etc/sysctl.d/99-fyrastack-dev.conf && sudo sysctl --system
```

this is needed cause the 3 proxmox nodes will make a lot of inotify instances.

`wireguard-tools` is needed to reach VM IPs from the host.

## First-time setup

1. `dev/vyos/build-image.sh`: builds `localhost/fyrastack/vyos:stream` from the latest VyOS Stream ISO (`rolling` for rolling)
2. `cd dev && podman compose up -d`
3. `dev/pve/init-cluster.sh`: forms the cluster, provisions storage/token/SDN, prints the `PROXMOX_*` env block
4. Copy `apps/dashboard/.env.example` to `apps/dashboard/.env` and set `BETTER_AUTH_SECRET` (any string in dev) and the `PROXMOX_TOKEN_SECRET` printed by `init-cluster.sh`; everything else defaults to the dev stack
5. `pnpm --filter stack-dashboard db:migrate`
6. `podman exec -i fyra-postgres psql -U postgres < dev/seed-ipam.sql`

## usage

- `pnpm dashboard dev`
- VM test IPs (`203.0.113.0/24`, `2001:db8:0:1::/64`, `2001:db8:100::/56`) from the host:
  `sudo wg-quick up dev/fyra-wg.conf` / `sudo wg-quick down dev/fyra-wg.conf`
- PVE web UIs: `https://127.0.0.1:8006`-`8008` (root / fyradev)

## Fixture UI mode (non-Linux)

Use fixture mode when you only need to test Svelte UI changes and do not want
to run Postgres, Proxmox, VyOS, or a Tetra/Podman host. This is the easiest path
on macOS.

Fixture mode is enabled by `ACCESSIBILITY_FIXTURES=1`. It installs a fake
authenticated admin session, a fake project, one fake VM, one fake managed host,
managed-host Podman fixture data, and a Quadlet bundle with nginx companion
files.

The Quadlet fixture mirrors the production storage split: unit files live in
the Podman Quadlet directory, while companion files live in a mutable data root
such as `/var/lib/tetra/quadlets/<bundle>` for system-scope Quadlets.

From the repo root:

```sh
CI=true \
ACCESSIBILITY_FIXTURES=1 \
CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE=postgres://fixture:fixture@127.0.0.1:5432/fixture \
pnpm --filter stack-dashboard run dev --host 127.0.0.1 --port 5173
```

The Hyperdrive connection string only satisfies Cloudflare adapter local
emulation. Fixture-backed routes do not connect to that database.

Useful fixture URLs:

- Stack brand managed host:
  `http://127.0.0.1:5173/projects/accessibility-project/hosts/accessibility-host`
- Managed host Podman tab:
  `http://127.0.0.1:5173/projects/accessibility-project/hosts/accessibility-host/podman`
- Managed host Podman container detail:
  `http://127.0.0.1:5173/projects/accessibility-project/hosts/accessibility-host/podman/demo-web`
- Managed host Quadlets tab:
  `http://127.0.0.1:5173/projects/accessibility-project/hosts/accessibility-host/quadlets`
- Managed host Quadlet detail:
  `http://127.0.0.1:5173/projects/accessibility-project/hosts/accessibility-host/quadlets/demo-web.container`
- Managed host Quadlet create from recipe:
  `http://127.0.0.1:5173/projects/accessibility-project/hosts/accessibility-host/quadlets/create`
- Managed host raw dispatch tab:
  `http://127.0.0.1:5173/projects/accessibility-project/hosts/accessibility-host/dispatch`
- Fixture VM:
  `http://127.0.0.1:5173/projects/accessibility-project/servers/accessibility-server`

To test Ultramarine branding, add `PUBLIC_DASHBOARD_BRAND=ultramarine` before
the command:

```sh
CI=true \
ACCESSIBILITY_FIXTURES=1 \
PUBLIC_DASHBOARD_BRAND=ultramarine \
CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE=postgres://fixture:fixture@127.0.0.1:5432/fixture \
pnpm --filter stack-dashboard run dev --host 127.0.0.1 --port 5173
```

Fixture data lives in
`apps/dashboard/src/lib/server/accessibility-fixtures.ts`. If a UI needs more
states for local testing, add them there and keep them deterministic.

## After a reboot or stack restart

```sh
cd dev && podman compose up -d
dev/pve/init-cluster.sh
```

the above rotates `PROXMOX_TOKEN_SECRET`, so update `.env` with the newly printed value. `podman compose down -v` for a factory reset.

## Caveats

- this currently only works on linux.
- no gurantees on vm performance.
