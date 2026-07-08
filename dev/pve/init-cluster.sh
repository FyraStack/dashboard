#!/usr/bin/env bash
set -euo pipefail

nodes=(fyra-pve1 fyra-pve2 fyra-pve3)
ips=(172.30.10.11 172.30.10.12 172.30.10.13)

if [ "$(sysctl -n fs.inotify.max_user_instances)" -lt 512 ]; then
	echo "fs.inotify.max_user_instances is too low for 3 PVE nodes; fix with:" >&2
	echo "  printf 'fs.inotify.max_user_instances=512\nfs.inotify.max_user_watches=1048576\n' | sudo tee /etc/sysctl.d/99-fyrastack-dev.conf && sudo sysctl --system" >&2
	echo "then restart the stack: podman compose --profile pve restart" >&2
	exit 1
fi

quorate() {
	podman exec "$1" pvesh get /cluster/status --output-format json 2>/dev/null |
		MIN="$2" python3 -c '
import json, os, sys
try:
	c = [e for e in json.load(sys.stdin) if e.get("type") == "cluster"]
	sys.exit(0 if c and c[0].get("quorate") and c[0].get("nodes", 0) >= int(os.environ["MIN"]) else 1)
except Exception:
	sys.exit(1)'
}

for node in "${nodes[@]}"; do
	echo "waiting for $node..."
	until podman exec "$node" pvesh get /version >/dev/null 2>&1; do sleep 3; done
done

if ! podman exec fyra-pve1 test -f /etc/pve/corosync.conf; then
	echo "creating cluster on pve1"
	podman exec fyra-pve1 pvecm create fyra
fi
until quorate fyra-pve1 1; do sleep 3; done

fingerprint=$(podman exec fyra-pve1 pvesh get /cluster/config/join --output-format json |
	python3 -c 'import json,sys; print(json.load(sys.stdin)["nodelist"][0]["pve_fp"])')

for i in 1 2; do
	node="${nodes[$i]}"
	if podman exec "$node" test -f /etc/pve/corosync.conf; then
		echo "$node already joined"
		continue
	fi
	echo "joining $node"
	podman exec "$node" pvesh create /cluster/config/join \
		--hostname "${ips[0]}" --password fyradev --fingerprint "$fingerprint" \
		--link0 "${ips[$i]}"
	until podman exec "$node" pvesh get /version >/dev/null 2>&1; do sleep 3; done
	until quorate fyra-pve1 "$((i + 1))"; do sleep 3; done
done

echo "waiting for quorum"
until quorate fyra-pve1 3; do sleep 3; done

podman exec fyra-pve1 sh -c 'mkdir -p /shared/stack/snippets && chmod -R 777 /shared/stack'
if ! podman exec fyra-pve1 pvesh get /storage/stack-volumes >/dev/null 2>&1; then
	podman exec fyra-pve1 pvesm add dir stack-volumes \
		--path /shared/stack --content images,iso,snippets,import --shared 1
fi

if ! podman exec fyra-pve1 pvesh get /cluster/firewall/groups/stack-dev >/dev/null 2>&1; then
	podman exec fyra-pve1 pvesh create /cluster/firewall/groups --group stack-dev
fi

if ! podman exec fyra-pve1 pvesh get /pools/stack-tenants >/dev/null 2>&1; then
	podman exec fyra-pve1 pvesh create /pools --poolid stack-tenants
fi

if ! podman exec fyra-pve1 pvesh get /cluster/sdn/zones/stack >/dev/null 2>&1; then
	podman exec fyra-pve1 pvesh create /cluster/sdn/zones --zone stack --type vxlan \
		--peers 172.30.10.11,172.30.10.12,172.30.10.13,172.30.10.20
fi
if ! podman exec fyra-pve1 pvesh get /cluster/sdn/vnets/public >/dev/null 2>&1; then
	podman exec fyra-pve1 pvesh create /cluster/sdn/vnets --vnet public --zone stack --tag 100
fi
podman exec fyra-pve1 pvesh set /cluster/sdn
for node in "${nodes[@]}"; do
	podman exec "$node" sh -c 'ifup vxlan_public 2>/dev/null; ifup public 2>/dev/null; true'
done

for node in "${nodes[@]}"; do
	podman exec "$node" sh -c '
cat > /usr/local/lib/watchdog-mux-stub.py <<'"'"'EOF'"'"'
import os
import socket
import threading

path = "/run/watchdog-mux.sock"
try:
    os.unlink(path)
except FileNotFoundError:
    pass

srv = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
srv.bind(path)
srv.listen()

def drain(conn):
    while conn.recv(4096):
        pass

while True:
    conn, _ = srv.accept()
    threading.Thread(target=drain, args=(conn,), daemon=True).start()
EOF
cat > /etc/systemd/system/watchdog-mux-stub.service <<'"'"'EOF'"'"'
[Unit]
Description=watchdog-mux stub
Before=pve-ha-lrm.service pve-ha-crm.service

[Service]
ExecStart=/usr/bin/python3 /usr/local/lib/watchdog-mux-stub.py

[Install]
WantedBy=multi-user.target
EOF
systemctl mask --now watchdog-mux >/dev/null 2>&1
systemctl daemon-reload
systemctl enable --now watchdog-mux-stub >/dev/null 2>&1
systemctl restart pve-ha-crm pve-ha-lrm
'
done

until podman exec fyra-gw test -f /data/host.conf 2>/dev/null; do sleep 3; done
podman exec fyra-gw cat /data/host.conf > "$(dirname "$0")/../fyra-wg.conf"

podman exec fyra-pve1 pveum user token remove root@pam stack >/dev/null 2>&1 || true
secret=$(podman exec fyra-pve1 pveum user token add root@pam stack --privsep 0 --output-format json |
	python3 -c 'import json,sys; print(json.load(sys.stdin)["value"])')

cat <<EOF

cluster ready.

pve web ui: https://127.0.0.1:8006 (pve2: 8007, pve3: 8008), user "root", password "fyradev"

dashboard .env:
  PROXMOX_API_URL="https://127.0.0.1:8006"
  PROXMOX_TOKEN_ID="root@pam!stack"
  PROXMOX_TOKEN_SECRET="$secret"
  PROXMOX_USE_VPC="false"
  PROXMOX_VM_FIREWALL_SECURITY_GROUP="stack-dev"
  PROXMOX_SNIPPETS_USE_VPC="false"
  PROXMOX_SNIPPETS_ENDPOINT_URL="http://127.0.0.1:8005"
  PROXMOX_SNIPPETS_ENDPOINT_USERNAME="dev"
  PROXMOX_SNIPPETS_ENDPOINT_PASSWORD="dev"
  PROXMOX_SNIPPETS_STORAGE="stack-volumes"

reach VM test IPs from the host:
  sudo dnf install wireguard-tools
  sudo wg-quick up $(realpath "$(dirname "$0")/../fyra-wg.conf")
EOF
