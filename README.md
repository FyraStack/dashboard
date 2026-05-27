# Stack Dashboard

## Install

1. `bun install`
2. start a postgres server

- `podman run -p 5432:5432 -e POSTGRES_PASSWORD=mysecretpassword -d postgres`
- if you want the data to persist:
  - `podman volume create postgres_volume`
  - `podman run -p 5432:5432 --replace --name dashboard_postgres -e POSTGRES_PASSWORD=mysecretpassword -v postgres_volume:/var/lib/postgresql -d postgres`
- more detailed guide: https://orm.drizzle.team/docs/guides/postgresql-local-setup

3. add secrets to .env

- required
  - generate better auth
  - autumn
  - postgres connection url
- highly recommended
  - proxmox
- optional
  - github
  - google
  - billing meter secret
  - cloudflare email key

4. setup db

- `bun run db:push`

## Usage (dev)

`bun run dev`




## dev instance setup

To test external connections you need to setup several other services.
This is instructions to setup optional services.

### netbox

https://github.com/netbox-community/netbox-docker/wiki/Getting-Started

```
git clone -b release https://github.com/netbox-community/netbox-docker.git
cd netbox-docker
# Copy the example override file
cp docker-compose.override.yml.example docker-compose.override.yml
# Read and edit the file to your liking
podman compose pull
podman compose up
```

### opnsense

```
sudo podman run --rm -it \
    --device /dev/kvm \
    --cap-add NET_ADMIN \
    -p 10443:443 \
    docker.io/koichirok/docker-opnsense:24.1.3
```

username: root
password: opnsense
