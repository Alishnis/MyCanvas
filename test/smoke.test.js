// Smoke tests: boot the real server.js against a fake Canvas API and check the
// proxy, auth and static-file behaviour. No network, no real token, no deps.
// Run with: npm test   (Node 18+)

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FAKE_TOKEN = 'test-token-not-real';

const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.once('error', reject);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

const listen = (server, port) => new Promise((r) => server.listen(port, '127.0.0.1', r));

/** Start server.js as a child process and resolve once it is listening. */
async function startApp(env) {
  const port = await freePort();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    // Every variable is set explicitly (even empty), because real env vars win
    // over a developer's local .env in server.js — tests must not depend on it.
    env: { PATH: process.env.PATH, PORT: String(port), HOST: '127.0.0.1', CANVAS_TOKEN: '', BASIC_AUTH_USER: '', BASIC_AUTH_PASS: '', ...env },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => reject(new Error(`server exited early (${code})`)));
    child.stdout.on('data', (d) => { if (String(d).includes('Canvas dashboard')) resolve(); });
  });
  child.removeAllListeners('exit');
  return { port, base: `http://127.0.0.1:${port}`, stop: () => child.kill() };
}

// --- fake Canvas: records requests, serves a two-page /courses list ---------

let canvas;
let canvasUrl;
const seen = [];

before(async () => {
  const port = await freePort();
  canvasUrl = `http://127.0.0.1:${port}`;
  canvas = http.createServer((req, res) => {
    seen.push({ url: req.url, auth: req.headers.authorization });
    const u = new URL(req.url, canvasUrl);
    res.setHeader('Content-Type', 'application/json');
    if (u.pathname === '/api/v1/courses' && u.searchParams.get('page') !== '2') {
      res.setHeader('Link', `<${canvasUrl}/api/v1/courses?page=2&per_page=100>; rel="next"`);
      return res.end(JSON.stringify([{ id: 1, name: 'Course A' }]));
    }
    if (u.pathname === '/api/v1/courses') return res.end(JSON.stringify([{ id: 2, name: 'Course B' }]));
    if (u.pathname === '/api/v1/users/self/profile') return res.end(JSON.stringify({ name: 'Test User' }));
    res.statusCode = 401;
    res.end(JSON.stringify({ errors: [{ message: 'nope' }] }));
  });
  await listen(canvas, port);
});

after(() => canvas.close());

test('serves the dashboard shell and reports a missing token without crashing', async () => {
  const app = await startApp({ CANVAS_BASE: canvasUrl });
  try {
    const page = await fetch(`${app.base}/`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /<main/);

    const cfg = await (await fetch(`${app.base}/api/_config`)).json();
    assert.deepEqual(cfg, { hasToken: false, base: canvasUrl });

    const api = await fetch(`${app.base}/api/courses`);
    assert.equal(api.status, 500);
    assert.match((await api.json()).error, /CANVAS_TOKEN is not set/);
  } finally { app.stop(); }
});

test('proxies to Canvas with the bearer token and follows pagination', async () => {
  seen.length = 0;
  const app = await startApp({ CANVAS_BASE: canvasUrl, CANVAS_TOKEN: FAKE_TOKEN });
  try {
    const res = await fetch(`${app.base}/api/courses?_all=1`);
    assert.equal(res.status, 200);
    assert.deepEqual((await res.json()).map((c) => c.id), [1, 2]);
    assert.equal(seen.length, 2);
    assert.ok(seen.every((r) => r.auth === `Bearer ${FAKE_TOKEN}`));

    // Second identical call is answered from the 60s cache — Canvas sees nothing new.
    await fetch(`${app.base}/api/courses?_all=1`);
    assert.equal(seen.length, 2);
  } finally { app.stop(); }
});

test('never leaks the token to the browser and maps Canvas 401 to a hint', async () => {
  const app = await startApp({ CANVAS_BASE: canvasUrl, CANVAS_TOKEN: FAKE_TOKEN });
  try {
    const res = await fetch(`${app.base}/api/users/self/profile`);
    assert.equal(res.status, 200);
    assert.ok(![...res.headers.values()].some((v) => v.includes(FAKE_TOKEN)));

    const denied = await fetch(`${app.base}/api/does/not/exist`);
    assert.equal(denied.status, 401);
    const body = await denied.json();
    assert.match(body.hint, /invalid, expired or revoked/);
    assert.ok(!JSON.stringify(body).includes(FAKE_TOKEN));
  } finally { app.stop(); }
});

test('rejects malformed API paths and never serves files outside public/', async () => {
  const app = await startApp({ CANVAS_BASE: canvasUrl, CANVAS_TOKEN: FAKE_TOKEN });
  // Raw socket: fetch() would normalise "../" away before it reached the server.
  const raw = (target) => new Promise((resolve, reject) => {
    const sock = net.connect(app.port, '127.0.0.1', () => sock.write(`GET ${target} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`));
    let buf = '';
    sock.on('data', (d) => { buf += d; });
    sock.on('end', () => resolve({ status: Number(buf.split(' ')[1]), body: buf }));
    sock.on('error', reject);
  });
  try {
    assert.equal((await raw('/api//courses')).status, 400);

    const escape = await raw('/../server.js');
    assert.ok([403, 404].includes(escape.status));
    assert.ok(!escape.body.includes('createServer'), 'server source must not be served');
  } finally { app.stop(); }
});

test('HTTP Basic Auth gates everything when credentials are configured', async () => {
  const app = await startApp({ CANVAS_BASE: canvasUrl, BASIC_AUTH_USER: 'u', BASIC_AUTH_PASS: 'p' });
  try {
    const anon = await fetch(`${app.base}/`);
    assert.equal(anon.status, 401);
    assert.match(anon.headers.get('www-authenticate'), /^Basic/);

    const wrong = await fetch(`${app.base}/`, { headers: { Authorization: 'Basic ' + Buffer.from('u:x').toString('base64') } });
    assert.equal(wrong.status, 401);

    const ok = await fetch(`${app.base}/`, { headers: { Authorization: 'Basic ' + Buffer.from('u:p').toString('base64') } });
    assert.equal(ok.status, 200);
  } finally { app.stop(); }
});

// --- pure frontend helpers (public/lib/util.js has no DOM use at import time) ---

test('util.js helpers: escaping, formatting, course codes, teaching weeks', async () => {
  const u = await import('../public/lib/util.js');
  assert.equal(u.esc(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  assert.equal(u.esc(null), '');
  assert.equal(u.num(null), '—');
  assert.equal(u.num(3), '3');
  assert.equal(u.num(2.456), '2.46');
  assert.equal(u.pct(87.65), '87.7%');
  assert.equal(u.shortCode({ course_code: '202609CS1302A' }), 'CS1302A');
  assert.equal(u.hueOf('123'), u.hueOf(123));
  assert.ok(u.hueOf('abc') >= 0 && u.hueOf('abc') < 360);
  assert.equal(u.weekOf(new Date(2026, 7, 31)), 1);
  assert.equal(u.weekOf(new Date(2026, 8, 7)), 2);
  assert.equal(u.weekOf(new Date(2026, 7, 30)), null);
  assert.equal(u.teacherLine({ teachers: ['A', 'B', 'C', 'D', 'E'].map((display_name) => ({ display_name })) }), 'A, B, C +2 more');
  assert.deepEqual(u.statusOf({ points_possible: 10, submission: { workflow_state: 'graded', score: 8 } }), { text: '8 / 10', cls: 'graded' });
  assert.equal(u.statusOf({ submission: { submitted_at: '2026-01-01' } }).text, 'Submitted');
});
