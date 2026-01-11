# Playlists Plus (Jellyfin plugin) — WIP

Admin-focused playlist management UI inside the Jellyfin Dashboard.

## What this repo gives you (already wired)
- Jellyfin plugin skeleton (net8.0) targeting Jellyfin **10.10.x**
- A **Dashboard page** (no external webapp) that uses Jellyfin's own APIs:
  - Load playlist items with **infinite scroll**
  - Client-side **sort by metadata** (premiere date, production year, name)
  - Apply the sorted order back to Jellyfin via **Move** API calls
  - Bulk helpers: move selected to **top/bottom** or **specific position**
- CI workflow to build & publish a zip artifact
- A template `manifest.json` and a helper script to generate checksums for a plugin repo

> Note: This is a starting point. The UI and ordering operations are implemented in vanilla JS (no build step).

## Quick start (dev)
### Requirements
- .NET SDK 8
- Jellyfin Server 10.10.x dev environment

### Build
```bash
dotnet restore
dotnet build -c Release
```

### Install locally (manual)
Copy the built dll output folder to Jellyfin plugins directory, e.g.:
- Linux: `/var/lib/jellyfin/plugins/Jellyfin.Plugin.PlaylistsPlus/`
- Docker: your mapped `/config/plugins/Jellyfin.Plugin.PlaylistsPlus/`

Restart Jellyfin and open:
Dashboard → **Plugins** → **Playlists Plus** → **Settings**

## Release & plugin repository
Jellyfin plugin repositories are served by a `manifest.json` containing plugin versions. Jellyfin's docs include an example manifest. citeturn13view0

See:
- `repo/manifest.json` (template)
- `tools/make-repo-manifest.ps1` / `tools/make-repo-manifest.sh`

## License
MIT (change if you prefer).
