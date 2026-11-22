# LinkPresent Desktop — Built-in Virtual Camera Wrapper (`desktop/`)

Phase 5 packages the offline **LinkPresent** web bundle (`linkpresent.html`, `js/`, `vendor/`, `office/`, `meeting/`) inside a thin Electron shell that outputs directly to a virtual camera (**"LinkPresent Camera"**).

This solves two enterprise blockers at once:
1. **Works in every meeting app** — Google Meet, Webex, Zoom, Microsoft Teams, and Loom without requiring marketplace app approvals or OBS Studio.
2. **Eliminates Windows webcam-busy conflicts** — LinkPresent captures the physical webcam *once*, runs on-device hand tracking + 3D slide compositing, and exposes the combined output as a standard camera device.

## Architecture

- [`server.js`](server.js) — Zero-dependency Node.js loopback server (`127.0.0.1`, ephemeral port) so packaged `.dmg` / `.msi` builds require **no Python installation**. Mirrors `server.py`'s strict folder allowlist (`vendor/ props/ js/ office/ meeting/`) and `js/` `Cache-Control: no-cache` headers.
- [`vcam.js`](vcam.js) — `VirtualCameraBridge` receiving BGRA frames from Electron's `webContents.beginFrameSubscription()` and forwarding them to the platform virtual camera sink:
  - **macOS:** CoreMediaIO Camera Extension (`LinkPresent Camera`)
  - **Windows:** DirectShow / Media Foundation virtual camera sink
  - **Linux:** `v4l2loopback` (`/dev/video2`) via `ffmpeg`
- [`preload.js`](preload.js) — Context-isolated `window.linkpresentDesktop` bridge (`startVirtualCam`, `stopVirtualCam`, `openMeetingSidebar`, `openLocalDeck`).
- [`main.js`](main.js) — Window lifecycle, automatic loopback camera permission grant, companion Presenter Sidebar (`/meeting/sidebar.html`), and CLI/MDM flags.

## Local Development

```bash
cd desktop
npm install
npm start
# Or launch straight into clean meeting view with virtual camera active:
npm run start:clean
```

> Note: `npm` is only used inside `desktop/` for Electron packaging. The core web app (`linkpresent.html`, `js/`, `server.py`) remains 100% build-step-free.

## Enterprise Packaging & Silent MDM Rollout

Build installers from `desktop/`:

```bash
npm run dist:mac   # Signed/notarized macOS .dmg (CoreMediaIO Camera Extension)
npm run dist:win   # Windows .msi + NSIS installer (DirectShow virtual camera)
```

### Silent Deployment Flags

- **Windows (Intune / SCCM):**
  ```powershell
  msiexec /i LinkPresent-1.0.0.msi /qn /norestart
  ```
- **CLI / Managed Launch Flags:**
  - `--clean` — Start directly in Meeting View (no top toolbar)
  - `--vcam` — Start Virtual Camera output immediately on launch
  - `--deck="C:\Path\Deck.pptx"` — Auto-load a local presentation in browser memory
  - `--no-telemetry` — Telemetry-free enterprise mode (default)
  - `--port=4890` — Pin local loopback port (defaults to an ephemeral free port)

## Privacy Guarantee

All `.pptx` unpacking (`js/pptx-parse.js`) and MediaPipe hand tracking (`vendor/wasm`, `js/hands.js`) run strictly in local memory. No telemetry, camera frames, or slide bytes ever leave the workstation.
