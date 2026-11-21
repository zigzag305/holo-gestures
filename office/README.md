# LinkPresent PowerPoint Add-in (Phase 3)

This folder contains the Microsoft Office Add-in (`Office.js`) wrapper that adds a **LinkPresent** button to PowerPoint's Home ribbon and launches the interactive 3D stage with the currently open presentation—without saving, exporting, or uploading your slides to any server.

## Files
- `manifest.xml` — Office Add-in manifest (`TaskPaneApp` for PowerPoint Desktop & Web).
- `taskpane.html` — Side-panel launcher that reads the open `.pptx` via `Office.context.document.getFileAsync(Office.FileType.Compressed)` and hands the raw bytes over `BroadcastChannel` / `postMessage` to `/linkpresent`.
- `icon-{16,32,64,80}.png` — Ribbon & AppSource icons.

## Sideloading locally for testing

Microsoft PowerPoint requires Office Add-ins to be served over **HTTPS**:

1. Start LinkPresent as usual:
   ```bash
   python3 server.py
   ```
2. Put a local HTTPS reverse proxy in front of port `4890` (for example with [Caddy](https://caddyserver.com/) or `mkcert` + `local-ssl-proxy`):
   ```bash
   caddy reverse-proxy --from https://localhost:4890 --to http://127.0.0.1:4890
   ```
   *(If deploying to a hosted HTTPS domain, replace `https://localhost:4890` in `manifest.xml` with your hosted origin.)*
3. Sideload `office/manifest.xml` in PowerPoint:
   - **PowerPoint on the Web:** Open a deck → **Home → Add-ins → More Add-ins → My Add-ins → Upload My Add-in** → pick `office/manifest.xml`.
   - **PowerPoint Desktop (macOS):** Copy `manifest.xml` to `~/Library/Containers/com.microsoft.Powerpoint/Data/Documents/wef/` (create `wef/` if needed), then restart PowerPoint → **Home → Add-ins**.
   - **PowerPoint Desktop (Windows):** Share a local folder with `manifest.xml` as a Trusted Add-in Catalog (**File → Options → Trust Center → Trust Center Settings → Trusted Add-in Catalogs**), or use `npx office-addin-debugging start office/manifest.xml`.

## How it works
1. Clicking **Present in LinkPresent** reads the active `.pptx` directly inside PowerPoint using `Office.js` (`ReadDocument` permission only).
2. A full LinkPresent stage window opens (`?launcher=office&clean=1`) and parses the `.pptx` completely client-side via `js/pptx-parse.js`.
3. Optionally, changing slides in PowerPoint syncs the LinkPresent stage slide in real time.
