/**
 * dev-server.mjs — 의존성 없는 최소 정적 파일 서버 (로컬 확인/e2e 테스트용).
 * GitHub Pages 배포에는 필요 없음 — fetch('daily/...')가 file:// 에서는 CORS로 막혀서
 * 로컬에서 열어볼 때만 필요.
 *
 *   node scripts/dev-server.mjs [port]   (기본 8420)
 */
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2]) || 8420;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

export function startServer(port = PORT) {
  const server = http.createServer(async (req, res) => {
    try {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/') p = '/index.html';
      const filePath = path.join(ROOT, p);
      if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
      const s = await stat(filePath);
      if (!s.isFile()) throw new Error('not a file');
      const body = await readFile(filePath);
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404); res.end('Not found');
    }
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

// 직접 실행됐을 때만 자동으로 띄움 (test-e2e.mjs처럼 import해서 쓸 수도 있게)
if (path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1] ?? '')) {
  const server = await startServer(PORT);
  console.log(`dev server → http://localhost:${server.address().port}/`);
}
