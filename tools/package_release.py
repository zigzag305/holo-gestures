#!/usr/bin/env python3
"""Package LinkPresent manifests for a production HTTPS origin.

Usage:
  python3 tools/package_release.py --origin https://app.linkpresent.io

Writes ready-to-upload files into state/release/:
  - office-manifest.xml     (PowerPoint Add-in manifest)
  - zoom-app.json           (Zoom App Marketplace descriptor)
  - linkpresent-teams.zip   (Microsoft Teams app package: manifest.json + icons)
"""
import argparse, json, os, sys, zipfile
from urllib.parse import urlparse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_ORIGIN = "https://localhost:4890"


def build_release(origin, out_dir):
    origin = origin.rstrip("/")
    parsed = urlparse(origin)
    if parsed.scheme != "https" or not parsed.netloc:
        raise ValueError("origin must be an https:// URL (e.g. https://app.linkpresent.io)")
    host = parsed.netloc
    hostname = parsed.hostname or host

    os.makedirs(out_dir, exist_ok=True)

    # 1. PowerPoint Office Add-in manifest
    office_xml = open(os.path.join(ROOT, "office", "manifest.xml"), encoding="utf-8").read()
    office_xml = office_xml.replace(DEFAULT_ORIGIN, origin)
    office_out = os.path.join(out_dir, "office-manifest.xml")
    with open(office_out, "w", encoding="utf-8") as f:
        f.write(office_xml)

    # 2. Zoom App descriptor
    zoom_raw = open(os.path.join(ROOT, "meeting", "zoom-app.json"), encoding="utf-8").read()
    zoom_data = json.loads(zoom_raw.replace(DEFAULT_ORIGIN, origin))
    allow = zoom_data.setdefault("oauth_information", {}).setdefault("Domain_allow_list", [])
    zoom_data["oauth_information"]["Domain_allow_list"] = [
        hostname if d in ("localhost", "localhost:4890") else d for d in allow
    ]
    zoom_out = os.path.join(out_dir, "zoom-app.json")
    with open(zoom_out, "w", encoding="utf-8") as f:
        json.dump(zoom_data, f, indent=2)

    # 3. Microsoft Teams package (.zip containing manifest.json + icon-32.png + icon-192.png)
    teams_raw = open(os.path.join(ROOT, "meeting", "teams-manifest.json"), encoding="utf-8").read()
    teams_data = json.loads(teams_raw.replace(DEFAULT_ORIGIN, origin))
    teams_data["validDomains"] = list(dict.fromkeys([host, hostname]))
    teams_zip = os.path.join(out_dir, "linkpresent-teams.zip")
    with zipfile.ZipFile(teams_zip, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("manifest.json", json.dumps(teams_data, indent=2))
        for icon in ("icon-32.png", "icon-192.png"):
            icon_path = os.path.join(ROOT, "meeting", icon)
            if not os.path.isfile(icon_path):
                raise FileNotFoundError(f"missing Teams icon: {icon_path}")
            zf.write(icon_path, arcname=icon)

    return {"office": office_out, "zoom": zoom_out, "teams": teams_zip}


def main():
    ap = argparse.ArgumentParser(description="Build production HTTPS manifests and Teams zip package.")
    ap.add_argument("--origin", required=True, help="Production HTTPS origin, e.g. https://app.linkpresent.io")
    ap.add_argument("--out", default=os.path.join(ROOT, "state", "release"), help="Output directory (default: state/release)")
    args = ap.parse_args()
    out = build_release(args.origin, args.out)
    for k, p in out.items():
        print(f"  {k:6s} -> {os.path.relpath(p, ROOT)}")


if __name__ == "__main__":
    main()
