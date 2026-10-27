#!/usr/bin/env python3
"""Backfill Fyra Stack SMBIOS type 1 branding onto existing VMs.

Run as root on any PVE cluster node. Dry-run by default; pass --apply to write.

CSV columns (header optional): stable_id,proxmox_id,tier
  01JABCDEFGHJKMNPQRSTVWXYZ0,1234,s1.small

Mirrors smbios1Branding()/rebrandSmbios1() in
apps/dashboard/src/lib/server/backends/proxmox/index.ts: sets manufacturer/family
to "Fyra Stack", product to the tier, serial to the stable id, and keeps the
existing SMBIOS UUID (plus any other fields). Takes effect on next cold boot.
"""

import argparse
import base64
import csv
import json
import subprocess
import sys
import uuid

BRAND = "Fyra Stack"
STABLE_ID_TAG_PREFIX = "vmid-"


def pvesh(*args: str):
    out = subprocess.run(
        ["pvesh", *args, "--output-format", "json"],
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    return json.loads(out) if out.strip() else None


def parse_smbios1(raw: str | None) -> tuple[dict[str, str], str | None]:
    entries = []
    for part in filter(None, (raw or "").split(",")):
        key, _, value = part.partition("=")
        entries.append((key, value))
    is_b64 = ("base64", "1") in entries
    fields: dict[str, str] = {}
    vm_uuid = None
    for key, value in entries:
        if key == "base64":
            continue
        if key == "uuid":
            vm_uuid = value
        else:
            fields[key] = base64.b64decode(value).decode() if is_b64 else value
    return fields, vm_uuid


def format_smbios1(fields: dict[str, str], vm_uuid: str) -> str:
    encoded = [
        f"{k}={base64.b64encode(v.encode()).decode()}" for k, v in fields.items()
    ]
    return ",".join(["base64=1", *encoded, f"uuid={vm_uuid}"])


def read_rows(path: str):
    with open(path, newline="") as f:
        for lineno, row in enumerate(csv.reader(f), 1):
            if not row or row[0].startswith("#"):
                continue
            if len(row) != 3:
                sys.exit(f"{path}:{lineno}: expected 3 columns, got {len(row)}")
            stable_id, proxmox_id, tier = (c.strip() for c in row)
            if lineno == 1 and not proxmox_id.isdigit():
                continue  # header
            if not proxmox_id.isdigit():
                sys.exit(f"{path}:{lineno}: proxmox_id {proxmox_id!r} is not a number")
            yield lineno, stable_id.lower(), int(proxmox_id), tier


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("csv", help="path to CSV (stable_id,proxmox_id,tier)")
    ap.add_argument(
        "--apply", action="store_true", help="actually write changes (default: dry run)"
    )
    ap.add_argument(
        "--skip-tag-check",
        action="store_true",
        help=f"don't require the VM's {STABLE_ID_TAG_PREFIX}<stable_id> tag to match the CSV",
    )
    args = ap.parse_args()

    resources = {
        r["vmid"]: r
        for r in pvesh("get", "/cluster/resources", "--type", "vm")
        if r.get("type") == "qemu"
    }

    failures = changed = 0
    for lineno, stable_id, vmid, tier in read_rows(args.csv):
        label = f"[{lineno}] {vmid} ({stable_id})"
        res = resources.get(vmid)
        if not res:
            print(f"{label}: SKIP, no such qemu VM in cluster", file=sys.stderr)
            failures += 1
            continue

        tags = set(filter(None, (res.get("tags") or "").replace(",", ";").split(";")))
        if not args.skip_tag_check and f"{STABLE_ID_TAG_PREFIX}{stable_id}" not in tags:
            print(
                f"{label}: SKIP, tag {STABLE_ID_TAG_PREFIX}{stable_id} not on VM (tags: {sorted(tags)})",
                file=sys.stderr,
            )
            failures += 1
            continue

        node = res["node"]
        config = pvesh("get", f"/nodes/{node}/qemu/{vmid}/config")
        current = config.get("smbios1")
        fields, vm_uuid = parse_smbios1(current)
        branding = {
            "manufacturer": BRAND,
            "product": tier,
            "family": BRAND,
            "serial": stable_id,
        }

        if vm_uuid and all(fields.get(k) == v for k, v in branding.items()):
            print(f"{label}: ok, already branded as {tier!r}")
            continue

        if not vm_uuid:
            vm_uuid = str(uuid.uuid4())
            print(f"{label}: note, no existing SMBIOS UUID, generated {vm_uuid}")
        new = format_smbios1({**fields, **branding}, vm_uuid)
        print(f"{label} on {node}: {fields.get('product')!r} -> {tier!r}")
        print(f"    old: {current}")
        print(f"    new: {new}")
        if args.apply:
            try:
                pvesh("set", f"/nodes/{node}/qemu/{vmid}/config", "--smbios1", new)
            except subprocess.CalledProcessError as e:
                print(f"{label}: FAILED: {e.stderr.strip()}", file=sys.stderr)
                failures += 1
                continue
        changed += 1

    verb = "updated" if args.apply else "would update"
    print(
        f"\n{verb} {changed} VM(s), {failures} skipped/failed. Changes apply on next stop/start."
    )
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
