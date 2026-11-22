'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

/**
 * Nearest-neighbor BGRA frame rescaler so Retina/HiDPI captures (e.g. 2560x1440)
 * always fit the virtual camera sink's fixed width x height without dropping frames.
 */
function rescaleBgra(src, srcW, srcH, dstW, dstH) {
  const out = Buffer.allocUnsafe(dstW * dstH * 4);
  for (let y = 0; y < dstH; y++) {
    const sy = Math.min(srcH - 1, Math.floor((y * srcH) / dstH));
    const srcRow = sy * srcW * 4;
    const dstRow = y * dstW * 4;
    for (let x = 0; x < dstW; x++) {
      const sx = Math.min(srcW - 1, Math.floor((x * srcW) / dstW));
      const si = srcRow + sx * 4;
      const di = dstRow + x * 4;
      out[di] = src[si];
      out[di + 1] = src[si + 1];
      out[di + 2] = src[si + 2];
      out[di + 3] = src[si + 3];
    }
  }
  return out;
}

/**
 * VirtualCameraBridge — pipes BGRA compositor frames from Electron's
 * webContents.beginFrameSubscription() to a platform virtual camera sink
 * ("LinkPresent Camera") so Google Meet, Zoom, Teams, and Webex see a single
 * clean camera feed with zero OBS setup and no Windows webcam-busy conflicts.
 *
 * Supported sinks:
 *   - 'v4l2'  (Linux):   ffmpeg rawvideo bgra -> /dev/video2 (v4l2loopback)
 *   - 'mac'   (macOS):   bundled bin/linkpresent-vcam-mac (CoreMediaIO Camera Extension helper)
 *   - 'win'   (Windows): bundled bin/linkpresent-vcam-win.exe (DirectShow / Media Foundation helper)
 *   - 'null'  (Test):    in-memory frame counter & throughput meter (no OS device)
 */
class VirtualCameraBridge {
  constructor(opts = {}) {
    this.width = opts.width || 1280;
    this.height = opts.height || 720;
    this.fps = opts.fps || 30;
    this.device = opts.device || defaultDevice(process.platform);
    this.sink = opts.sink || defaultSink(process.platform);
    this.binDir = opts.binDir || path.join(__dirname, 'bin');
    this.active = false;
    this.frames = 0;
    this.dropped = 0;
    this.rescaled = 0;
    this.startedAt = 0;
    this.lastError = null;
    this._proc = null;
    this._unsubscribe = null;
  }

  detectCapabilities() {
    const helperName = this.sink === 'mac' ? 'linkpresent-vcam-mac'
      : this.sink === 'win' ? 'linkpresent-vcam-win.exe'
      : null;
    const helperPath = helperName ? path.join(this.binDir, helperName) : null;
    const nativeReady = this.sink === 'null'
      ? true
      : this.sink === 'v4l2'
        ? fs.existsSync(this.device)
        : !!(helperPath && fs.existsSync(helperPath));
    return {
      platform: process.platform,
      sink: this.sink,
      device: this.device,
      helperPath,
      nativeReady,
    };
  }

  status() {
    const elapsedSec = this.active && this.startedAt ? Math.max(0.001, (Date.now() - this.startedAt) / 1000) : 0;
    return {
      active: this.active,
      platform: process.platform,
      sink: this.sink,
      device: this.device,
      width: this.width,
      height: this.height,
      targetFps: this.fps,
      frames: this.frames,
      dropped: this.dropped,
      rescaled: this.rescaled,
      actualFps: elapsedSec ? Number((this.frames / elapsedSec).toFixed(1)) : 0,
      lastError: this.lastError,
      capabilities: this.detectCapabilities(),
    };
  }

  _spawnSink() {
    if (this.sink === 'null') return true;
    if (this.sink === 'v4l2') {
      const args = [
        '-f', 'rawvideo', '-pix_fmt', 'bgra', '-s', `${this.width}x${this.height}`, '-r', String(this.fps),
        '-i', 'pipe:0', '-pix_fmt', 'yuv420p', '-f', 'v4l2', this.device,
      ];
      return this._launchProcess('ffmpeg', args, 'v4l2 sink');
    }
    if (this.sink === 'mac' || this.sink === 'win') {
      const cap = this.detectCapabilities();
      if (!cap.nativeReady) {
        this.lastError = `Native ${this.sink === 'mac' ? 'CoreMediaIO' : 'DirectShow'} helper not installed (${cap.helperPath}). See desktop/README.md.`;
        return false;
      }
      const args = ['--width', String(this.width), '--height', String(this.height), '--fps', String(this.fps), '--device', this.device];
      return this._launchProcess(cap.helperPath, args, `${this.sink} virtual camera`);
    }
    this.lastError = `Unsupported virtual camera sink: ${this.sink}`;
    return false;
  }

  _launchProcess(cmd, args, label) {
    try {
      this._proc = spawn(cmd, args, { stdio: ['pipe', 'ignore', 'pipe'] });
      this._proc.on('error', (err) => { this.lastError = `${label}: ${err.message}`; this.stop(); });
      this._proc.on('exit', (code) => {
        if (this.active && code !== 0) this.lastError = `${label} exited (${code})`;
        this.active = false;
        this._proc = null;
      });
      return true;
    } catch (err) {
      this.lastError = `${label}: ${err.message}`;
      return false;
    }
  }

  start(webContents = null) {
    if (this.active) return this.status();
    this.frames = 0;
    this.dropped = 0;
    this.rescaled = 0;
    this.lastError = null;
    this.startedAt = Date.now();
    this.active = true;

    if (!this._spawnSink()) {
      this.active = false;
      return this.status();
    }

    if (webContents && typeof webContents.beginFrameSubscription === 'function') {
      webContents.beginFrameSubscription(false, (image) => {
        if (!this.active) return;
        const size = typeof image.getSize === 'function' ? image.getSize() : { width: this.width, height: this.height };
        this.pushFrame(image.toBitmap(), size.width, size.height);
      });
      this._unsubscribe = () => {
        try { webContents.endFrameSubscription(); } catch (_) {}
      };
    }

    return this.status();
  }

  pushFrame(bgraBuffer, srcW = this.width, srcH = this.height) {
    if (!this.active || !bgraBuffer) return false;
    const expected = this.width * this.height * 4;
    let payload = bgraBuffer;
    if (payload.length !== expected) {
      if (srcW > 0 && srcH > 0 && payload.length === srcW * srcH * 4) {
        payload = rescaleBgra(payload, srcW, srcH, this.width, this.height);
        this.rescaled++;
      } else {
        this.dropped++;
        return false;
      }
    }
    this.frames++;
    if (this._proc && this._proc.stdin && !this._proc.stdin.destroyed) {
      if (!this._proc.stdin.write(payload)) {
        this.dropped++;
      }
    }
    return true;
  }

  stop() {
    this.active = false;
    if (this._unsubscribe) {
      this._unsubscribe();
      this._unsubscribe = null;
    }
    if (this._proc) {
      try { this._proc.stdin.end(); } catch (_) {}
      try { this._proc.kill('SIGTERM'); } catch (_) {}
      this._proc = null;
    }
    return this.status();
  }
}

function defaultSink(platform) {
  if (platform === 'darwin') return 'mac';
  if (platform === 'win32') return 'win';
  if (platform === 'linux') return 'v4l2';
  return 'null';
}

function defaultDevice(platform) {
  if (platform === 'darwin') return 'LinkPresent Camera (CoreMediaIO)';
  if (platform === 'win32') return 'LinkPresent Camera (DirectShow)';
  return '/dev/video2';
}

module.exports = { VirtualCameraBridge, rescaleBgra, defaultSink, defaultDevice };
