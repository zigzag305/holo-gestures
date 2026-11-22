'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');

const ALLOWED_STATIC = new Set(['vendor', 'props', 'js', 'office', 'meeting']);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.wasm': 'application/wasm',
  '.task': 'application/octet-stream',
  '.glb': 'model/gltf-binary',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

function send(res, code, body, ctype = 'application/json; charset=utf-8', fresh = false) {
  const buf = Buffer.isBuffer(body)
    ? body
    : typeof body === 'string'
      ? Buffer.from(body)
      : Buffer.from(JSON.stringify(body));
  const headers = {
    'Content-Type': ctype,
    'Content-Length': String(buf.length),
  };
  if (ctype.startsWith('text/html')) {
    headers['Cache-Control'] = 'no-store';
  } else if (fresh) {
    headers['Cache-Control'] = 'no-cache';
  }
  res.writeHead(code, headers);
  res.end(buf);
}

function listDecks(rootDir) {
  const dir = path.join(rootDir, 'decks');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((n) => n.toLowerCase().endsWith('.pptx') && !n.startsWith('~$') && !n.startsWith('.'))
    .map((n) => {
      const st = fs.statSync(path.join(dir, n));
      return { name: n, size: st.size, mtime: st.mtimeMs / 1000 };
    })
    .sort((a, b) => b.mtime - a.mtime);
}

/**
 * Resolve a static request path against ALLOWED_STATIC with strict path-traversal protection.
 * Returns the absolute file path or null if rejected.
 */
function resolveStaticPath(rootDir, urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch (_) {
    return null;
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return null;
  const trimmed = decoded.replace(/^\/+/, '');
  const normalized = path.posix.normalize(trimmed);
  if (normalized.startsWith('..') || normalized.includes('/../') || normalized === '..') return null;
  const top = normalized.split('/')[0];
  if (!ALLOWED_STATIC.has(top)) return null;
  const full = path.resolve(rootDir, normalized);
  const rootResolved = path.resolve(rootDir);
  if (!full.startsWith(rootResolved + path.sep)) return null;
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return null;
  return { full, top };
}

/**
 * Start a loopback-only HTTP server serving the offline LinkPresent bundle without Python.
 * Client-side .pptx parsing (js/pptx-parse.js) handles all local decks in browser memory.
 */
function startDesktopServer(rootDir, port = 0) {
  const server = http.createServer((req, res) => {
    const parsed = new URL(req.url || '/', 'http://127.0.0.1');
    const p = parsed.pathname;

    if (req.method !== 'GET') {
      return send(res, 405, { error: 'desktop server is read-only; decks unpack in browser memory' });
    }

    if (p === '/' || p === '/holo.html') {
      const f = path.join(rootDir, 'holo.html');
      return fs.existsSync(f)
        ? send(res, 200, fs.readFileSync(f), MIME['.html'])
        : send(res, 404, { error: 'holo.html missing' });
    }
    if (p === '/linkpresent' || p === '/linkpresent.html') {
      const f = path.join(rootDir, 'linkpresent.html');
      return fs.existsSync(f)
        ? send(res, 200, fs.readFileSync(f), MIME['.html'])
        : send(res, 404, { error: 'linkpresent.html missing' });
    }
    if (p === '/office' || p === '/office/') {
      const f = path.join(rootDir, 'office', 'taskpane.html');
      return fs.existsSync(f)
        ? send(res, 200, fs.readFileSync(f), MIME['.html'])
        : send(res, 404, { error: 'office/taskpane.html missing' });
    }
    if (p === '/meeting' || p === '/meeting/') {
      const f = path.join(rootDir, 'meeting', 'sidebar.html');
      return fs.existsSync(f)
        ? send(res, 200, fs.readFileSync(f), MIME['.html'])
        : send(res, 404, { error: 'meeting/sidebar.html missing' });
    }
    if (p === '/privacy' || p === '/privacy.html' || p === '/terms' || p === '/terms.html') {
      const fname = p.includes('privacy') ? 'privacy.html' : 'terms.html';
      const f = path.join(rootDir, fname);
      return fs.existsSync(f)
        ? send(res, 200, fs.readFileSync(f), MIME['.html'])
        : send(res, 404, { error: `${fname} missing` });
    }
    if (p === '/api/version') {
      return send(res, 200, { build: 'desktop', branch: null, mode: 'offline-desktop' });
    }
    if (p === '/api/decks') {
      return send(res, 200, listDecks(rootDir));
    }
    if (p === '/api/deck/raw') {
      const name = parsed.searchParams.get('name') || '';
      if (!name || path.basename(name) !== name || !name.toLowerCase().endsWith('.pptx')) {
        return send(res, 400, { error: 'invalid deck name' });
      }
      const f = path.join(rootDir, 'decks', name);
      if (!fs.existsSync(f) || !fs.statSync(f).isFile()) {
        return send(res, 404, { error: 'not found' });
      }
      return send(res, 200, fs.readFileSync(f), MIME['.pptx']);
    }

    const hit = resolveStaticPath(rootDir, p);
    if (hit) {
      const ext = path.extname(hit.full).toLowerCase();
      return send(res, 200, fs.readFileSync(hit.full), MIME[ext] || 'application/octet-stream', hit.top === 'js');
    }
    return send(res, 404, { error: 'not found' });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const addr = server.address();
      resolve({
        server,
        port: addr.port,
        baseUrl: `http://127.0.0.1:${addr.port}`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

module.exports = { ALLOWED_STATIC, resolveStaticPath, startDesktopServer };
