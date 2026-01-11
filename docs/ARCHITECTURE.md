# Architecture

This plugin is designed to avoid a separate web app:
- It adds a **Dashboard page** to Jellyfin.
- The page is served as embedded resources from the plugin assembly.
- The page calls Jellyfin's existing HTTP API endpoints.

## Components
- `Plugin`:
  - Registers `IHasWebPages` entries for `configPage.html`, `playlistsplus.js`, `playlistsplus.css`
- Dashboard page:
  - Plain HTML + JS
  - Infinite scroll loads the playlist items
  - Sorting and bulk actions compute a target order and apply via Move operations

## Why not an external webapp?
External apps are more flexible and can use modern toolchains, but:
- you wanted this to be "admin responsibility" and live in the Dashboard
- avoiding extra deployment keeps it easy to adopt

## Security model
Everything runs under the authenticated admin session in Jellyfin's Dashboard.
No extra auth logic is implemented here.
