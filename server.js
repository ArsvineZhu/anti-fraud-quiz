const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');

const QUESTIONS = require('./data/questions');
const { createGameStore } = require('./lib/game-store');
const { handleApiRequest } = require('./lib/quiz-api');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, 'public');
const store = createGameStore(QUESTIONS);

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

function serveStatic(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeType = MIME_TYPES[ext] || 'application/octet-stream';
  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }

    res.writeHead(200, {
      'Content-Type': mimeType,
      'Cache-Control': 'no-store',
    });
    res.end(data);
  });
}

function servePage(res, page) {
  serveStatic(res, path.join(PUBLIC_DIR, page));
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url || '/', `http://${req.headers.host || `localhost:${PORT}`}`);
  const handled = await handleApiRequest(req, res, { store });
  if (handled) return;

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Method Not Allowed');
    return;
  }

  if (requestUrl.pathname === '/') {
    servePage(res, 'index.html');
    return;
  }

  if (requestUrl.pathname === '/admin') {
    servePage(res, 'admin.html');
    return;
  }

  if (requestUrl.pathname === '/monitor') {
    servePage(res, 'monitor.html');
    return;
  }

  if (requestUrl.pathname.startsWith('/api/')) {
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: '接口不存在' }));
    return;
  }

  let assetPath;
  try {
    assetPath = path.resolve(PUBLIC_DIR, `.${decodeURIComponent(requestUrl.pathname)}`);
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Bad Request');
    return;
  }

  if (assetPath.startsWith(`${PUBLIC_DIR}${path.sep}`) && fs.existsSync(assetPath)) {
    serveStatic(res, assetPath);
    return;
  }

  servePage(res, 'index.html');
});

server.listen(PORT, () => {
  console.log(`Anti-fraud quiz running at http://localhost:${PORT}`);
});
