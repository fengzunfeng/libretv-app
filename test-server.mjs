// 迷你测试服务器：模拟安卓壳 serveLocal 的映射逻辑
// - /xxx?_rsc= → 返回 xxx/index.txt (text/x-component)
// - /xxx      → 返回 xxx/index.html
// - 静态资源  → 原样返回
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'C:/LibreTV/out';
const PORT = 8777;

const MIME = {
  '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
  '.txt': 'text/plain', '.xml': 'text/xml',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const rsc = url.searchParams.has('_rsc');
  let rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
  if (rel === '') rel = rsc ? 'index.txt' : 'index.html';
  else if (!rel.includes('.')) rel = rel + '/index' + (rsc ? '.txt' : '.html');
  // 与安卓壳 serveLocal 相同的映射：RSC payload 内相对 static/chunks/... → _next/static/chunks/...
  for (const marker of ['static/chunks/', 'static/css/', 'static/media/']) {
    const i = rel.indexOf(marker);
    if (i >= 0) { rel = '_next/' + rel.substring(i); break; }
  }

  const root = path.resolve(ROOT);
  const abs = path.resolve(root, rel);
  if (!fs.existsSync(abs)) {
    res.statusCode = 404;
    res.end('404 ' + rel);
    return;
  }
  const ext = path.extname(abs);
  const mime = rsc ? 'text/x-component' : (MIME[ext] || 'application/octet-stream');
  res.setHeader('Content-Type', mime);
  res.end(fs.readFileSync(abs));
});

server.listen(PORT, () => console.log('test server on http://127.0.0.1:' + PORT));
