# CODEX handoff notes — Playlists Plus

This repo is intentionally a **starter scaffold**:
- The plugin registers a **Dashboard config page** and serves embedded static files.
- The page uses Jellyfin's **existing Playlist endpoints** for most operations.

## Core idea
Do as much as possible *client-side* inside the Dashboard:
- Load playlist items: `GET /Playlists/{playlistId}/Items?startIndex=0&limit=...&fields=...`
- Reorder: `POST /Playlists/{playlistId}/Items/{playlistItemId}/Move/{newIndex}`

Why:
- Minimal server-side code
- Works with your fork/PR that changes Next Up behavior, independently of this UI.

## Next iterations (recommended)
1. **Drag-and-drop reordering**
   - Current UI has basic up/down + move-to-index.
   - Add HTML5 DnD:
     - dragstart stores playlistItemId + original index
     - drop triggers a Move call
     - consider batching and/or "apply" mode to avoid excessive calls.

2. **Metadata-driven ordering modes**
   - Add "Chronology tag" support:
     - pick a provider field (e.g., `Tagline`, `SortName`, custom `Tag`, or `ProviderId`)
     - allow admin to define a custom numeric ordering per item
   - Server-side persistence option:
     - store per-playlist overrides in plugin config or a small sqlite

3. **Auto-include items from Collections**
   - Two options:
     - client-side: query collection items and offer "sync"
     - server-side: scheduled task that keeps a playlist in sync with a collection

4. **Performance / reliability**
   - Use concurrency-limited Move operations (currently sequential with small delay)
   - Add resumable operations and progress persistence.

## Where to implement
- UI: `src/.../Configuration/` (html/js/css)
- Plugin: `src/.../Plugin.cs` and `Configuration/PluginConfiguration.cs`
- If you need server endpoints later, add `Api/` controllers and call them from the UI.

## Debug tips
- Jellyfin logs will show plugin load errors; common causes:
  - missing resource build action (must be EmbeddedResource)
  - incompatible target ABI (match server version)
