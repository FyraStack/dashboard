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
4. Copy `apps/backend/.env.example` to `apps/backend/.env` and set `BETTER_AUTH_SECRET` (any string in dev) and the `PROXMOX_TOKEN_SECRET` printed by `init-cluster.sh`; everything else defaults to the dev stack
5. `pnpm --filter stack-backend db:migrate`
6. `podman exec -i fyra-postgres psql -U postgres < dev/seed-ipam.sql`

## usage

- `pnpm dev` (backend on 5174, dashboard on 5173)
- VM test IPs (`203.0.113.0/24`, `2001:db8:0:1::/64`, `2001:db8:100::/56`) from the host:
  `sudo wg-quick up dev/fyra-wg.conf` / `sudo wg-quick down dev/fyra-wg.conf`
- PVE web UIs: `https://127.0.0.1:8006`-`8008` (root / fyradev)
- the backend talks to Proxmox and VyOS over plain HTTP through `fyra-tls-proxy` (`127.0.0.1:18006` and `18443`), because workerd can't skip TLS verification for their self-signed certs

## After a reboot or stack restart

```sh
cd dev && podman compose up -d
dev/pve/init-cluster.sh
```

the above rotates `PROXMOX_TOKEN_SECRET`, so update `apps/backend/.env` with the newly printed value. `podman compose down -v` for a factory reset.

## fixture UI mode (non-Linux)

Use fixture mode when you only need to test Svelte UI changes and do not want
to run Postgres, Proxmox, VyOS, etc. This is the easiest path on macOS.

Fixture mode is enabled by `ACCESSIBILITY_FIXTURES=1`. It installs a fake
authenticated admin session, a fake project, and one fake VM.

From the repo root:

```sh
CI=true \
ACCESSIBILITY_FIXTURES=1 \
pnpm --filter stack-dashboard run dev --host localhost --port 5173
```

## Caveats

- this currently only works on linux.
- no gurantees on vm performance.
