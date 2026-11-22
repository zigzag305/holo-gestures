'use strict';

const { spawn } = require('child_process');

/**
 * VirtualCameraBridge — pipes BGRA compositor frames from Electron's
 * webContents.beginFrameSubscription() to a platform virtual camera sink
 * ("LinkPresent Camera") so Google Meet, Zoom, Teams, and Webex see a single
 * clean camera feed with zero OBS setup and no Windows webcam-busy conflicts.
 *
 * Supported sinks:
 *   - 'v4l2'  (Linux):   ffmpeg rawvideo bgra -> /dev/video2 (v4l2loopback)
 *   - 'mac'   (macOS):   CoreMediaIO Camera Extension helper (or ffmpeg sink)
 *   - 'win'   (Windows): DirectShow / Media Foundation virtual cam sink
 *   - 'null'  (Test):    in-memory frame counter & throughput meter (no OS device)
 */
class VirtualCameraBridge {
  constructor(opts = {}) {
    this.width = opts.width || 1280;
    this.height = opts.height || 720;
    this.fps = opts.fps || 30;
    this.device = opts.device || defaultDevice(process.platform);
    this.sink = opts.sink || defaultSink(process.platform);
    this.active = false;
    this.frames = 0;
    this.dropped = 0;
    this.startedAt = 0;
    this.lastError = null;
    this._proc = null;
    this._unsubscribe = null;
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
      actualFps: elapsedSec ? Number((this.frames / elapsedSec).toFixed(1)) : 0,
      lastError: this.lastError,
    };
  }

  start(webContents = null) {
    if (this.active) return this.status();
    this.frames = 0;
    this.dropped = 0;
    this.lastError = null;
    this.startedAt = Date.now();
    this.active = true;

    if (this.sink === 'v4l2') {
      const args = [
        '-f', 'rawvideo',
        '-pix_fmt', 'bgra',
        '-s', `${this.width}x${this.height}`,
        '-r', String(this.fps),
        '-i', 'pipe:0',
        '-pix_fmt', 'yuv420p',
        '-f', 'v4l2',
        this.device,
      ];
      try {
        this._proc = spawn('ffmpeg', args, { stdio: ['pipe', 'ignore', 'pipe'] });
        this._proc.on('error', (err) => { this.lastError = err.message; this.stop(); });
        this._proc.on('exit', (code) => {
          if (this.active && code !== 0) this.lastError = `v4l2 sink exited (${code})`;
          this.active = false;
          this._proc = null;
        });
      } catch (err) {
        this.lastError = err.message;
        this.active = false;
        return this.status();
      }
    }

    if (webContents && typeof webContents.beginFrameSubscription === 'function') {
      webContents.beginFrameSubscription(false, (image) => {
        if (!this.active) return;
        const bitmap = image.toBitmap();
        this.pushFrame(bitmap);
      });
      this._unsubscribe = () => {
        try { webContents.endFrameSubscription(); } catch (_) {}
      };
    }

    return this.status();
  }

  pushFrame(bgraBuffer) {
    if (!this.active || !bgraBuffer) return false;
    const expected = this.width * this.height * 4;
    if (bgraBuffer.length !== expected) {
      this.dropped++;
      return false;
    }
    this.frames++;
    if (this._proc && this._proc.stdin && !this._proc.stdin.destroyed) {
      if (!this._proc.stdin.write(bgraBuffer)) {
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

module.exports = { VirtualCameraBridge, defaultSink, defaultDevice };
