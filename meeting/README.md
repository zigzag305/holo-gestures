# LinkPresent — Zoom App & Microsoft Teams Meeting App (`meeting/`)

This folder packages **LinkPresent** as a native **Meeting Sidebar + Share-to-Stage** app for **Microsoft Teams** and **Zoom**, so presenters can drive interactive 3D `.pptx` slides with one hand and a bottom-right self-view tile without installing OBS.

## Files

- `sidebar.html` — Compact Presenter Sidebar (`320–360px` wide) providing:
  - Sample deck selector + local `.pptx` loader (parsed 100% in browser memory via `js/pptx-parse.js`).
  - **Share Stage to Meeting** button (`microsoftTeams.meeting.shareAppContentToStage` in Teams, `zoomSdk.startCollaborate` in Zoom, or a synced stage window in any browser).
  - Live slide list, speaker notes viewer, `‹ PREV` / `NEXT ›`, and `✦ PULL APART` / `◉ REBUILD` trigger.
  - One-click toggles for **Stage Mode** (clean meeting view, no top bar) and **Camera Mode** (bottom-right self-view tile).
- `teams-manifest.json` — Microsoft Teams v1.17 app manifest (`meetingSidePanel` + `meetingStage`, `devicePermissions: ["media"]`).
- `zoom-app.json` — Zoom App descriptor (`zoomapp:inmeeting`, `shareApp`, `startCollaborate`).

## Local Preview

With `python3 server.py` running:

1. Open `http://localhost:4890/meeting` (or `/meeting/sidebar.html`).
2. Pick a sample deck or click **LOAD .PPTX FILE**, then click **SHARE STAGE TO MEETING**.
3. Use the sidebar's slide list, `‹ PREV` / `NEXT ›`, `✦ PULL APART`, or **Stage Mode / Camera Mode** checkboxes—or use one-hand gestures directly on the stage window—and watch both views stay in sync.

## Sideloading into Microsoft Teams or Zoom

Both Teams and Zoom require an **HTTPS** endpoint for meeting apps:

1. Expose port `4890` over HTTPS (for example `caddy reverse-proxy --from https://localhost:8443 --to http://localhost:4890` or a local tunnel) and update `https://localhost:4890` in `teams-manifest.json` / `zoom-app.json` if using a different host.
2. **Microsoft Teams:** Zip `teams-manifest.json` together with `icon-32.png` and `icon-192.png` (from `office/`), then upload via **Teams → Apps → Manage your apps → Upload an app**.
3. **Zoom:** Import `zoom-app.json` (or configure the Home URL & Domain Allow List) in the Zoom App Marketplace developer console and add the app to an active meeting.

## Privacy Guarantee

All `.pptx` parsing (`js/pptx-parse.js`) and hand tracking (`vendor/wasm`, `js/hands.js`) run locally inside the presenter's browser webview. Neither camera frames nor slide bytes are uploaded to any backend server.
