const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('Vercel deployment target is static public files plus api functions', () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

  assert.equal(config.framework, null);
  assert.equal(config.buildCommand, null);
  assert.equal(config.outputDirectory, 'public');
  assert.ok(config.functions['api/**/*.js']);
  assert.equal(fs.existsSync(path.join(root, 'server.js')), false);
  assert.equal(fs.existsSync(path.join(root, 'local-server.js')), true);
  assert.match(packageJson.scripts.start, /local-server\.js/);
});
