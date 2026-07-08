#!/bin/sh
set -eu

apk add --no-cache wireguard-tools iproute2 iptables >/dev/null
sysctl -qw net.ipv4.ip_forward=1 net.ipv6.conf.all.forwarding=1

if [ ! -f /data/server.key ]; then
	umask 077
	wg genkey | tee /data/server.key | wg pubkey > /data/server.pub
	wg genkey | tee /data/host.key | wg pubkey > /data/host.pub
fi

cat > /data/host.conf <<EOF
[Interface]
PrivateKey = $(cat /data/host.key)
Address = 10.100.0.2/24, fd00:100::2/64

[Peer]
PublicKey = $(cat /data/server.pub)
Endpoint = 127.0.0.1:51820
AllowedIPs = 203.0.113.0/24, 2001:db8:0:1::/64, 2001:db8:100::/56
PersistentKeepalive = 25
EOF

ip link del wg0 2>/dev/null || true
ip link add wg0 type wireguard
wg set wg0 private-key /data/server.key listen-port 51820 \
	peer "$(cat /data/host.pub)" allowed-ips 10.100.0.2/32,fd00:100::2/128
ip addr add 10.100.0.1/24 dev wg0
ip addr add fd00:100::1/64 dev wg0
ip link set wg0 up

ip link del vxlan100 2>/dev/null || true
ip link add vxlan100 type vxlan id 100 dstport 4789 local 172.30.10.20 dev eth0
for peer in 172.30.10.11 172.30.10.12 172.30.10.13; do
	bridge fdb append 00:00:00:00:00:00 dev vxlan100 dst "$peer"
done
ip addr add 203.0.113.1/24 dev vxlan100
ip addr add 2001:db8:0:1::1/64 dev vxlan100
ip addr add fe80::1040:ffff/64 dev vxlan100
ip link set vxlan100 up
ip -6 route add 2001:db8:100::/56 dev vxlan100

iptables -t nat -C POSTROUTING -o vxlan100 -j MASQUERADE 2>/dev/null ||
	iptables -t nat -A POSTROUTING -o vxlan100 -j MASQUERADE
iptables -t nat -C POSTROUTING -o eth0 -j MASQUERADE 2>/dev/null ||
	iptables -t nat -A POSTROUTING -o eth0 -j MASQUERADE
ip6tables -t nat -C POSTROUTING -o vxlan100 -j MASQUERADE 2>/dev/null ||
	ip6tables -t nat -A POSTROUTING -o vxlan100 -j MASQUERADE

exec sleep infinity
