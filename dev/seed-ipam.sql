INSERT INTO ipam_prefixes (id, name, cidr, family, gateway_address, ipv6_use_transit_address, bunny_dns_zone)
VALUES
	('01JZ0DEVSEED000000000V4000', 'dev-ipv4', '203.0.113.0/24', 'ipv4', '203.0.113.1', false, '113.0.203.in-addr.arpa'),
	('01JZ0DEVSEED000000000V6TR0', 'dev-ipv6-transit', '2001:db8:0:1::/64', 'ipv6', NULL, true, '1.0.0.0.0.0.0.0.8.b.d.0.1.0.0.2.ip6.arpa'),
	('01JZ0DEVSEED000000000V6PF0', 'dev-ipv6-prefixes', '2001:db8:100::/56', 'ipv6', NULL, false, '0.0.0.0.1.0.8.b.d.0.1.0.0.2.ip6.arpa')
ON CONFLICT (cidr) DO NOTHING;
