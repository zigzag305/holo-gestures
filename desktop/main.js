'use strict';

const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, dialog, ipcMain, session } = require('electron');
const { startDesktopServer } = require('./server');
const { VirtualCameraBridge } = require('./vcam');

function parseFlags(argv) {
  const flags = { clean: false, vcam: false, noTelemetry: true, port: 0, deck: null };
  for (const arg of argv) {
    if (arg === '--clean') flags.clean = true;
    else if (arg === '--vcam') flags.vcam = true;
    else if (arg === '--no-telemetry') flags.noTelemetry = true;
    else if (arg.startsWith('--port=')) flags.port = parseInt(arg.slice(7), 10) || 0;
    else if (arg.startsWith('--deck=')) flags.deck = arg.slice(7);
  }
  return flags;
}

const FLAGS = parseFlags(process.argv.slice(1));
const APP_ROOT = app.isPackaged
  ? path.join(process.resourcesPath, 'app')
  : path.resolve(__dirname, '..');

let serverHandle = null;
let stageWin = null;
let sidebarWin = null;
const vcam = new VirtualCameraBridge({ width: 1280, height: 720, fps: 30 });

async function createStageWindow() {
  const qs = new URLSearchParams();
  if (FLAGS.clean) qs.set('clean', '1');
  if (FLAGS.deck) qs.set('launcher', 'desktop');
  const query = qs.toString();

  stageWin = new BrowserWindow({
    width: 1280,
    height: 720,
    backgroundColor: '#070b0f',
    title: 'LinkPresent — Stage',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  await stageWin.loadURL(`${serverHandle.baseUrl}/linkpresent${query ? '?' + query : ''}`);

  if (FLAGS.deck && fs.existsSync(FLAGS.deck)) {
    const buf = fs.readFileSync(FLAGS.deck);
    const b64 = buf.toString('base64');
    const name = path.basename(FLAGS.deck);
    stageWin.webContents.executeJavaScript(`(() => {
      const bin = Uint8Array.from(atob(${JSON.stringify(b64)}), c => c.charCodeAt(0));
      window.postMessage({ type: 'linkpresent-deck', buffer: bin.buffer, name: ${JSON.stringify(name)}, slide: 1 }, location.origin);
    })()`);
  }

  if (FLAGS.vcam) {
    vcam.start(stageWin.webContents);
  }

  stageWin.on('closed', () => {
    vcam.stop();
    stageWin = null;
  });
}

function openSidebarWindow() {
  if (sidebarWin && !sidebarWin.isDestroyed()) {
    sidebarWin.focus();
    return;
  }
  sidebarWin = new BrowserWindow({
    width: 380,
    height: 760,
    backgroundColor: '#070b0f',
    title: 'LinkPresent — Presenter Controls',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  sidebarWin.loadURL(`${serverHandle.baseUrl}/meeting/sidebar.html`);
  sidebarWin.on('closed', () => { sidebarWin = null; });
}

app.whenReady().then(async () => {
  // Approve local camera permissions automatically for the loopback LinkPresent origin
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const url = webContents.getURL() || '';
    const isLocal = url.startsWith('http://127.0.0.1:');
    callback(isLocal && (permission === 'media' || permission === 'camera'));
  });

  serverHandle = await startDesktopServer(APP_ROOT, FLAGS.port);

  ipcMain.handle('desktop:status', () => ({
    flags: FLAGS,
    baseUrl: serverHandle.baseUrl,
    vcam: vcam.status(),
  }));
  ipcMain.handle('desktop:vcam-start', (_, opts) => {
    if (opts && opts.device) vcam.device = opts.device;
    if (stageWin && !stageWin.isDestroyed()) {
      stageWin.setContentSize(vcam.width, vcam.height);
      stageWin.setResizable(false);
    }
    const st = vcam.start(stageWin ? stageWin.webContents : null);
    if (!st.active && stageWin && !stageWin.isDestroyed()) stageWin.setResizable(true);
    return st;
  });
  ipcMain.handle('desktop:vcam-stop', () => {
    const st = vcam.stop();
    if (stageWin && !stageWin.isDestroyed()) stageWin.setResizable(true);
    return st;
  });
  ipcMain.handle('desktop:open-sidebar', () => { openSidebarWindow(); return { ok: true }; });
  ipcMain.handle('desktop:open-deck', async () => {
    const res = await dialog.showOpenDialog(stageWin || undefined, {
      title: 'Open PowerPoint Presentation',
      filters: [{ name: 'PowerPoint', extensions: ['pptx'] }],
      properties: ['openFile'],
    });
    if (res.canceled || !res.filePaths.length) return { canceled: true };
    const fp = res.filePaths[0];
    return { canceled: false, name: path.basename(fp), base64: fs.readFileSync(fp).toString('base64') };
  });

  await createStageWindow();
});

app.on('window-all-closed', async () => {
  vcam.stop();
  if (serverHandle) await serverHandle.close();
  app.quit();
});
