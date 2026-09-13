const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const vercelHandler = require('./vercel-handler');

function getJavaScriptFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return getJavaScriptFiles(entryPath);
    return entry.name.endsWith('.js') ? [entryPath] : [];
  });
}

test('Vercel deployment target is static public files plus api functions', () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const apiFiles = getJavaScriptFiles(path.join(root, 'api'));

  assert.equal(config.framework, null);
  assert.equal(config.buildCommand, null);
  assert.equal(config.outputDirectory, 'public');
  assert.ok(config.functions['api/**/*.js']);
  assert.equal(apiFiles.length, 12);
  assert.deepEqual(
    config.rewrites.map((rewrite) => rewrite.source),
    ['/api/health', '/admin', '/admin/', '/monitor', '/monitor/'],
  );
  for (const publicFile of ['index.html', 'admin.html', 'monitor.html']) {
    assert.equal(fs.existsSync(path.join(root, 'public', publicFile)), true);
  }
  for (const apiFile of apiFiles) {
    assert.match(fs.readFileSync(apiFile, 'utf8'), /vercel-handler/);
  }
  assert.equal(fs.existsSync(path.join(root, 'server.js')), false);
  assert.equal(fs.existsSync(path.join(root, 'local-server.js')), true);
  assert.match(packageJson.scripts.start, /local-server\.js/);
});

test('Vercel entry wrapper enforces hosted storage policy without platform env hints', async () => {
  const keys = [
    'QUIZ_STORAGE',
    'UPSTASH_REDIS_REST_URL',
    'UPSTASH_REDIS_REST_TOKEN',
    'KV_REST_API_URL',
    'KV_REST_API_TOKEN',
    'VERCEL',
    'VERCEL_ENV',
    'NODE_ENV',
  ];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  keys.forEach((key) => delete process.env[key]);

  const response = {
    statusCode: 200,
    body: '',
    setHeader() {},
    end(body) {
      this.body = body;
    },
  };

  try {
    await vercelHandler(
      { method: 'GET', url: '/api/meta?health=1', headers: { host: 'example.com' } },
      response,
    );
    assert.equal(response.statusCode, 503);
    assert.match(JSON.parse(response.body).error, /Redis/);
  } finally {
    keys.forEach((key) => {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    });
  }
});
