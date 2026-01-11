#!/usr/bin/env bash
set -euo pipefail

# Updates repo/manifest.json with checksum + timestamp for a local plugin zip.
# Usage:
#   tools/make-repo-manifest.sh path/to/Jellyfin.Plugin.PlaylistsPlus_0.1.0.0.zip

ZIP_PATH="${1:-}"
if [[ -z "${ZIP_PATH}" || ! -f "${ZIP_PATH}" ]]; then
  echo "Usage: $0 path/to/plugin.zip" >&2
  exit 2
fi

CHECKSUM="$(md5sum "${ZIP_PATH}" | awk '{print $1}')"
TS="$(date '+%Y-%m-%d %H:%M:%S')"

python3 - <<PY
import json, sys
p='repo/manifest.json'
with open(p,'r',encoding='utf-8') as f:
    data=json.load(f)
data[0]['versions'][0]['checksum']= '${CHECKSUM}'
data[0]['versions'][0]['timestamp']= '${TS}'
with open(p,'w',encoding='utf-8') as f:
    json.dump(data,f,indent=2)
print('Updated',p,'checksum=', '${CHECKSUM}', 'timestamp=', '${TS}')
PY
