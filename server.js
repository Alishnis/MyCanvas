#!/usr/bin/env node
// Canvas Dashboard — local server: static files + authenticated proxy to the Canvas REST API.
// Zero dependencies. Node 18+ (needs global fetch).

import http from 'node:http';
import { Readable } from 'node:stream';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual } from 'node:crypto';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'public');

// ---------------------------------------------------------------- config

async function loadEnv() {
  let raw;
  try {
    raw = await fs.readFile(path.join(ROOT, '.env'), 'utf8');
  } catch {
    return; // no .env is fine — real env vars may be set instead
  }
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

await loadEnv();

const CANVAS_BASE = (process.env.CANVAS_BASE || 'https://canvas.cityu.edu.hk').replace(/\/+$/, '');
const CANVAS_TOKEN = (process.env.CANVAS_TOKEN || '').trim();
const PORT = Number(process.env.PORT || 5173);
const HOST = process.env.HOST || '127.0.0.1';
const AUTH_USER = process.env.BASIC_AUTH_USER || '';
const AUTH_PASS = process.env.BASIC_AUTH_PASS || '';

// ---------------------------------------------------------------- cache

const CACHE_TTL_MS = 60_000;
const cache = new Map(); // key -> { at, status, body }

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit;
}

// ---------------------------------------------------------------- canvas proxy

/** Extract the `rel="next"` URL from a Link header, if present. */
function nextLink(header) {
  if (!header) return null;
  for (const part of header.split(',')) {
    const m = part.match(/<([^>]+)>\s*;\s*rel="?next"?/);
    if (m) return m[1];
  }
  return null;
}

const MAX_PAGES = 20;
const REQUEST_TIMEOUT_MS = 20_000;
// Lecture slide decks are big and Canvas sends them slowly.
const FILE_TIMEOUT_MS = 60_000;
// Canvas starts dropping connections when a client opens many at once — a
// heavy course (a notice board with dozens of "assignments") is enough to make
// the whole burst fail. Keep a small number in flight and queue the rest.
const MAX_CONCURRENT = 4;

let active = 0;
const waiting = [];

const acquire = () =>
  active < MAX_CONCURRENT
    ? (active++, Promise.resolve())
    : new Promise((resolve) => waiting.push(resolve));

function release() {
  const next = waiting.shift();
  if (next) next();
  else active--;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** One Canvas request, queued, with a timeout and two retries on transport failure. */
async function canvasFetch(url) {
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    await acquire();
    try {
      return await fetch(url, {
        headers: {
          Authorization: `Bearer ${CANVAS_TOKEN}`,
          Accept: 'application/json+canvas-string-ids, application/json',
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      lastErr = err;
    } finally {
      release();
    }
    await sleep(300 * 2 ** attempt);
  }
  throw lastErr;
}

/**
 * Proxy one Canvas API call. When `all` is set, follows `rel="next"` links and
 * concatenates the JSON arrays into a single response.
 */
async function proxyCanvas(apiPath, params, { all }) {
  const search = new URLSearchParams(params);
  if (!search.has('per_page')) search.set('per_page', '100');
  let url = `${CANVAS_BASE}/api/v1${apiPath}?${search.toString()}`;

  let merged = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await canvasFetch(url);
    const text = await res.text();

    if (!res.ok) {
      let detail;
      try { detail = JSON.parse(text); } catch { detail = { raw: text.slice(0, 500) }; }
      return {
        status: res.status,
        body: {
          error: `Canvas returned ${res.status}`,
          detail,
          hint: res.status === 401
            ? 'Access token is invalid, expired or revoked. Create a new one at ' + CANVAS_BASE + '/profile/settings and update .env.'
            : res.status === 403
              ? /rate limit/i.test(text)
                ? 'Canvas is throttling this token. Wait a minute and hit Refresh.'
                : 'Canvas refused this request. Your enrolment may not grant access to this data.'
              : undefined,
        },
      };
    }

    let data;
    try { data = JSON.parse(text); } catch { return { status: 502, body: { error: 'Canvas sent a non-JSON response' } }; }

    if (!all || !Array.isArray(data)) return { status: 200, body: data };

    merged = merged ? merged.concat(data) : data;
    const next = nextLink(res.headers.get('link'));
    if (!next) break;
    url = next;
  }
  return { status: 200, body: merged ?? [] };
}

/**
 * Stream one Canvas file through the proxy. Course HTML is full of <img> tags
 * pointing at /courses/:id/files/:id, which need the token — served from here
 * they resolve, and lecture PDFs open in the browser without leaving the app.
 */
async function serveFile(id, res) {
  const meta = await proxyCanvas(`/files/${id}`, new URLSearchParams(), { all: false });
  if (meta.status !== 200) { sendJson(res, meta.status, meta.body); return; }

  // The url Canvas hands back carries its own verifier, so no auth header here.
  const upstream = await fetch(meta.body.url, { signal: AbortSignal.timeout(FILE_TIMEOUT_MS) });
  if (!upstream.ok || !upstream.body) {
    sendJson(res, 502, { error: `Canvas returned ${upstream.status} for that file` });
    return;
  }
  const headers = {
    'Content-Type': meta.body['content-type'] || upstream.headers.get('content-type') || 'application/octet-stream',
    // inline: a PDF opens in the browser's own viewer instead of downloading
    'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(meta.body.display_name || id)}`,
    'Cache-Control': 'private, max-age=600',
  };
  const length = meta.body.size ?? upstream.headers.get('content-length');
  if (length != null) headers['Content-Length'] = String(length);
  res.writeHead(200, headers);
  Readable.fromWeb(upstream.body).pipe(res);
}

// ---------------------------------------------------------------- static files

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

async function serveStatic(pathname, res) {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const file = path.join(PUBLIC_DIR, rel);
  // Keep the request inside public/ regardless of what the client sent.
  if (!file.startsWith(PUBLIC_DIR + path.sep) && file !== path.join(PUBLIC_DIR, 'index.html')) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  try {
    const data = await fs.readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      // no-store, not no-cache: browsers hold on to ES modules hard, and a
      // stale module after an edit looks exactly like a bug in the new code.
      'Cache-Control': 'no-store',
    }).end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
  }
}

// ---------------------------------------------------------------- server

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  }).end(payload);
}

// Constant-time compare so a mistyped password can't be brute-forced faster
// via response-time differences.
function safeEqual(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function authorized(req) {
  if (!AUTH_USER && !AUTH_PASS) return true; // unset — e.g. local-only use
  const header = req.headers.authorization || '';
  if (!header.startsWith('Basic ')) return false;
  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  const sep = decoded.indexOf(':');
  if (sep === -1) return false;
  const user = decoded.slice(0, sep);
  const pass = decoded.slice(sep + 1);
  return safeEqual(user, AUTH_USER) && safeEqual(pass, AUTH_PASS);
}

const server = http.createServer(async (req, res) => {
  if (!authorized(req)) {
    res.writeHead(401, {
      'WWW-Authenticate': 'Basic realm="Canvas Dashboard"',
      'Content-Type': 'text/plain; charset=utf-8',
    }).end('Authentication required');
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  const fileMatch = url.pathname.match(/^\/file\/(\d+)$/);
  if (fileMatch) {
    if (!CANVAS_TOKEN) { sendJson(res, 500, { error: 'CANVAS_TOKEN is not set.' }); return; }
    try {
      await serveFile(fileMatch[1], res);
    } catch (err) {
      sendJson(res, 502, { error: 'Could not fetch that file', detail: String(err?.message || err) });
    }
    return;
  }

  if (!url.pathname.startsWith('/api/')) {
    if (req.method !== 'GET') { res.writeHead(405).end('Method not allowed'); return; }
    await serveStatic(url.pathname, res);
    return;
  }

  // --- /api/_config: lets the UI show a setup screen instead of a wall of 401s.
  if (url.pathname === '/api/_config') {
    sendJson(res, 200, { hasToken: Boolean(CANVAS_TOKEN), base: CANVAS_BASE });
    return;
  }

  if (!CANVAS_TOKEN) {
    sendJson(res, 500, { error: 'CANVAS_TOKEN is not set. Copy .env.example to .env and add your token.' });
    return;
  }

  const apiPath = url.pathname.slice('/api'.length); // keeps the leading slash
  if (apiPath.includes('..') || apiPath.includes('//') || /^\/\w+:/.test(apiPath)) {
    sendJson(res, 400, { error: 'Invalid API path' });
    return;
  }

  const params = new URLSearchParams(url.search);
  const all = params.get('_all') === '1';
  const fresh = params.get('_fresh') === '1';
  params.delete('_all');
  params.delete('_fresh');

  const key = `${apiPath}?${params.toString()}&all=${all}`;
  if (fresh) cache.delete(key);
  else {
    const hit = cacheGet(key);
    if (hit) { sendJson(res, hit.status, hit.body); return; }
  }

  try {
    const { status, body } = await proxyCanvas(apiPath, params, { all });
    if (status === 200) cache.set(key, { at: Date.now(), status, body });
    sendJson(res, status, body);
  } catch (err) {
    const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    sendJson(res, 504, {
      error: timedOut
        ? `Canvas did not answer within ${REQUEST_TIMEOUT_MS / 1000}s`
        : `Could not reach ${CANVAS_BASE}`,
      detail: String(err?.message || err),
      hint: timedOut ? 'This course may simply be large. Hit Refresh to try again.' : undefined,
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`\n  Canvas dashboard  →  http://localhost:${PORT}`);
  console.log(`  Canvas instance   →  ${CANVAS_BASE}`);
  console.log(`  Access token      →  ${CANVAS_TOKEN ? 'loaded' : 'MISSING — see README.md'}\n`);
});
