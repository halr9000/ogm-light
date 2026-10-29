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
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(abs)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

// Strip attributes that would break same-origin cookie auth.
function rewriteSetCookie(h) {
  return h.replace(/;\s*Domain=[^;]*/gi, '').replace(/;\s*Secure/gi, '');
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
      headers: { ...req.headers, host: `${TARGET_HOST}:${TARGET_PORT}` },
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
