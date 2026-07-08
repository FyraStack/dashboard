INSERT INTO ipam_prefixes (id, name, cidr, family, gateway_address, ipv6_use_transit_address)
VALUES
	('01JZ0DEVSEED000000000V4000', 'dev-ipv4', '203.0.113.0/24', 'ipv4', '203.0.113.1', false),
	('01JZ0DEVSEED000000000V6TR0', 'dev-ipv6-transit', '2001:db8:0:1::/64', 'ipv6', NULL, true),
	('01JZ0DEVSEED000000000V6PF0', 'dev-ipv6-prefixes', '2001:db8:100::/56', 'ipv6', NULL, false)
ON CONFLICT (cidr) DO NOTHING;
