# Stack Dashboard

## Install

1. `pnpm install`
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

- `pnpm --filter stack-dashboard db:push`

## Usage (dev)

`pnpm dev`

## dev instance setup

To test external connections you need to setup several other services.
This is instructions to setup optional services.

### opnsense

opnsense VM on ultramarine

1. `sudo dnf in virt-manager qemu`
2. `sudo systemctl enable libvirtd --now`
3. download: https://pkg.opnsense.org/releases/26.1.6/OPNsense-26.1.6-vga-amd64.img.bz2
4. `bzip2 -d OPNsense-26.1.6-vga-amd64.img.bz2`
5. open `virt-manager`
6. File > Add Connection > Connect
7. New VM
8. import existing disk image, Browse, Browse Local, select OPNsense.img
9. select freebsd 14.3 as OS
10. hit forward till you hit memory config
11. set ram to 4096MB
12. forward till step 4
13. select customize configuration before install
14. forward
15. add a second virtual disk for the installed copy of opnsense. you should get a screen with all the hardware, and at the bottom left there is an add hardware button.
16. Begin Installation in top right
17. wait for opnsense installer img to boot. you may need to hit enter a couple times and set network interfaces. the virtual network should be the LAN.
18. login with following credentials. user: installer, pass: opnsense
19. in the installer config, most things are default or obvious, but you need to use the "Install (UFS)" option. ZFS requires multiple drives.
20. after install, shutdown the system, not reboot. we need to go into the VM config and remove the install disk from the boot device order. its under boot options. disable disk 1 and enable disk 2.
21. boot the vm back up
22. login with the credentials: user: root, pass: opnsense
23. use option 2 "set interface IP address" and hit yes to set ipv4 and ipv6 via DHCP
24. you can now access the web gui via the ip address that was assigned.

username: root
password: opnsense
