#!/usr/bin/env bash
set -euo pipefail

# Updates manifest.json with checksum + timestamp for a local plugin zip.
# Usage:
#   tools/make-repo-manifest.sh path/to/Jellyfin.Plugin.PlaylistsPlus_v0.1.0.zip [version]

ZIP_PATH="${1:-}"
VERSION_ARG="${2:-}"
if [[ -z "${ZIP_PATH}" || ! -f "${ZIP_PATH}" ]]; then
  echo "Usage: $0 path/to/plugin.zip [version]" >&2
  exit 2
fi

CHECKSUM="$(md5sum "${ZIP_PATH}" | awk '{print $1}' | tr '[:lower:]' '[:upper:]')"
TS="$(date -u '+%Y-%m-%d')"
export ZIP_PATH VERSION_ARG CHECKSUM TS

python3 - <<PY
import json, os
p='manifest.json'
with open(p,'r',encoding='utf-8') as f:
    data=json.load(f)

zip_path = os.environ.get('ZIP_PATH', '')
version = os.environ.get('VERSION_ARG', '')
checksum = os.environ.get('CHECKSUM', '')
timestamp = os.environ.get('TS', '')
if not version:
    import re
    m = re.search(r'_v([0-9]+\\.[0-9]+\\.[0-9]+(?:\\.[0-9]+)?)\\.zip$', zip_path)
    if not m:
        raise SystemExit('Version not provided and could not be parsed from filename.')
    version = m.group(1)

if version.count('.') == 2:
    manifest_version = f"{version}.0"
else:
    manifest_version = version

repo = os.environ.get('GITHUB_REPOSITORY', 'fumasa/jellyfin-playlists-plus-plugin')
tag = f"v{version}"
source_url = f"https://github.com/{repo}/releases/download/{tag}/Jellyfin.Plugin.PlaylistsPlus_v{version}.zip"
changelog = f"https://github.com/{repo}/releases/tag/{tag}"

guid = "b9b9a50f-8b3a-4d2a-9c0e-7e2d0d7c2d73"
plugin = next((p for p in data if p.get("guid") == guid), None)
if plugin is None:
    raise SystemExit("Plugin GUID not found in manifest.json")

versions = plugin.get("versions") or []
versions = [v for v in versions if v.get("version") != manifest_version]
versions.insert(0, {
    "version": manifest_version,
    "changelog": changelog,
    "targetAbi": "10.10.3.0",
    "sourceUrl": source_url,
    "checksum": checksum,
    "timestamp": timestamp
})
plugin["versions"] = versions

with open(p,'w',encoding='utf-8') as f:
    json.dump(data,f,indent=2)
    f.write('\\n')
print('Updated',p,'version=', manifest_version, 'checksum=', checksum, 'timestamp=', timestamp)
PY
