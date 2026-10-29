#!/usr/bin/env node
// ogm-light server: static files + same-origin API proxy to the local OGM.
// No dependencies. Cookie auth works because /api/* stays same-origin.
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.OGML_PORT || 3222);
const TARGET_HOST = process.env.OGML_TARGET || '127.0.0.1';
const TARGET_PORT = Number(process.env.OGML_TARGET_PORT || 3005);
const PUBLIC = path.join(__dirname, 'public');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function serveStatic(req, res) {
  let file = req.url.split('?')[0];
  if (file === '/' || file === '') file = '/index.html';
  const abs = path.join(PUBLIC, path.normalize(file).replace(/^([./\\])+/, ''));
  if (!abs.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.readFile(abs, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(abs)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
}

// The backend's session cookie is odm_session. Browsers only ever see
// ogml_session: any stale/oddly-attributed odm_session cookie left in a
// device jar (e.g. from a dev iteration) can then never shadow the live
// session — the proxy strips odm_session from requests and re-adds it
// solely from ogml_session, so exactly one session cookie reaches OGM.
const COOKIE_IN = 'odm_session';
const COOKIE_OUT = 'ogml_session';

// Strip attributes that would break same-origin cookie auth; rename cookie.
function rewriteSetCookie(h) {
  return h
    .replace(/^(\s*)odm_session=/, '$1ogml_session=')
    .replace(/;\s*Domain=[^;]*/gi, '')
    .replace(/;\s*Secure/gi, '');
}

function rewriteRequestCookies(header) {
  if (!header) return header;
  const pairs = header.split(';').map(s => s.trim()).filter(Boolean);
  const ogml = pairs.find(p => p.startsWith(COOKIE_OUT + '='));
  const kept = pairs.filter(p => !p.startsWith(COOKIE_IN + '=') && !p.startsWith(COOKIE_OUT + '='));
  if (ogml) kept.push(`${COOKIE_IN}=${ogml.slice(COOKIE_OUT.length + 1)}`);
  return kept.join('; ');
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (!url.pathname.startsWith('/api/')) return serveStatic(req, res);

  const proxied = http.request(
    {
      host: TARGET_HOST,
      port: TARGET_PORT,
      path: url.pathname + url.search,
      method: req.method,
      headers: (() => {
        const h = { ...req.headers, host: `${TARGET_HOST}:${TARGET_PORT}` };
        const rc = rewriteRequestCookies(req.headers.cookie);
        if (rc) h.cookie = rc; else delete h.cookie;
        return h;
      })(),
    },
    (up) => {
      const headers = { ...up.headers };
      if (headers['set-cookie']) {
        headers['set-cookie'] = [].concat(headers['set-cookie']).map(rewriteSetCookie);
      }
      res.writeHead(up.statusCode, headers);
      // pipe keeps SSE / streamed bodies flowing chunk by chunk
      up.pipe(res);
    },
  );
  proxied.on('error', (e) => {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `OGM unreachable: ${e.message}` }));
  });
  req.pipe(proxied);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`ogm-light: http://0.0.0.0:${PORT}  ->  http://${TARGET_HOST}:${TARGET_PORT}`);
});
