const test = require('node:test');
const assert = require('node:assert/strict');

const {
  startGame,
  syncRoomState,
} = require('./game-state');
const { createGameStore, MemoryGameStore } = require('./game-store');
const { handleApiRequest } = require('./quiz-api');
const QUESTIONS = require('../data/questions');

function makeRequest(method, url, body, headers = {}) {
  return {
    method,
    url,
    body,
    headers: {
      host: 'localhost:3000',
      ...headers,
    },
  };
}

function makeResponse() {
  return {
    statusCode: 200,
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
    },
    end(body) {
      this.body = body;
    },
  };
}

async function invoke(store, method, url, body, headers) {
  const req = makeRequest(method, url, body, headers);
  const res = makeResponse();
  const handled = await handleApiRequest(req, res, { store });
  return {
    handled,
    status: res.statusCode,
    headers: res.headers,
    body: JSON.parse(res.body),
  };
}

test('meta uses the forwarded public origin for QR links', async () => {
  const store = new MemoryGameStore(QUESTIONS);
  const result = await invoke(store, 'GET', '/api/meta', undefined, {
    'x-forwarded-host': 'quiz.arsvine.com',
    'x-forwarded-proto': 'https',
  });

  assert.equal(result.handled, true);
  assert.equal(result.status, 200);
  assert.equal(result.body.accessUrl, 'https://quiz.arsvine.com/');
  assert.equal(result.body.adminUrl, 'https://quiz.arsvine.com/admin');
});

test('health reports the storage mode used by the runtime', async () => {
  const result = await invoke(new MemoryGameStore(QUESTIONS), 'GET', '/api/health');
  const rewrittenResult = await invoke(new MemoryGameStore(QUESTIONS), 'GET', '/api/meta?health=1');

  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { ok: true, storage: 'memory' });
  assert.equal(rewrittenResult.status, 200);
  assert.deepEqual(rewrittenResult.body, { ok: true, storage: 'memory' });
});

test('join, start, answer, leaderboard, and admin access share one store', async () => {
  const previousPin = process.env.ADMIN_PIN;
  const previousVercel = process.env.VERCEL;
  const previousVercelEnv = process.env.VERCEL_ENV;
  delete process.env.ADMIN_PIN;
  delete process.env.VERCEL;
  delete process.env.VERCEL_ENV;

  try {
    const store = new MemoryGameStore(QUESTIONS);
    const joined = await invoke(store, 'POST', '/api/join', { name: '小林' });
    assert.equal(joined.status, 200);
    assert.equal(joined.body.player.name, '小林');
    assert.match(joined.body.player.id, /^player-[0-9a-f-]{36}$/);
    assert.equal(Object.hasOwn(joined.body.players[0], 'id'), false);
    assert.equal(joined.body.players[0].isMe, true);
    assert.equal(joined.body.questions.some((question) => Object.hasOwn(question, 'answer')), false);

    const started = await invoke(store, 'POST', '/api/admin/start', { pin: '2026' });
    assert.equal(started.status, 200);
    assert.equal(started.body.status, 'countdown');

    await store.transact((state) => ({
      state: syncRoomState(state, state.countdownEndsAt),
    }));

    const question = joined.body.questions[0];
    const answered = await invoke(store, 'POST', '/api/answer', {
      playerId: joined.body.player.id,
      questionId: question.id,
      choiceIndex: question.options.findIndex((_, index) => index === 1),
      elapsedMs: 1000,
    });
    assert.equal(answered.status, 200);
    assert.equal(answered.body.accepted, true);
    assert.equal(answered.body.player.answered, 1);

    const leaderboard = await invoke(store, 'GET', '/api/leaderboard');
    assert.equal(leaderboard.body.players.length, 1);
    assert.equal(leaderboard.body.players[0].name, '小林');

    const admin = await invoke(store, 'GET', '/api/admin/room', undefined, {
      'x-admin-pin': '2026',
    });
    assert.equal(admin.status, 200);
    assert.equal(admin.body.monitor.totalPlayers, 1);
    assert.equal(admin.body.players[0].answered, 1);
    assert.equal(Object.hasOwn(admin.body.players[0], 'id'), false);

    const monitor = await invoke(store, 'GET', '/api/monitor');
    assert.equal(Object.hasOwn(monitor.body.leaderboard[0], 'id'), false);
    assert.equal(Object.hasOwn(monitor.body.recentActivity[0], 'playerId'), false);
  } finally {
    if (previousPin === undefined) delete process.env.ADMIN_PIN;
    else process.env.ADMIN_PIN = previousPin;
    if (previousVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = previousVercel;
    if (previousVercelEnv === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = previousVercelEnv;
  }
});

test('Vercel admin access fails clearly when ADMIN_PIN is missing', async () => {
  const previousPin = process.env.ADMIN_PIN;
  const previousVercel = process.env.VERCEL;
  delete process.env.ADMIN_PIN;
  process.env.VERCEL = '1';

  try {
    const result = await invoke(new MemoryGameStore(QUESTIONS), 'GET', '/api/admin/room');
    assert.equal(result.status, 503);
    assert.match(result.body.error, /ADMIN_PIN/);
  } finally {
    if (previousPin === undefined) delete process.env.ADMIN_PIN;
    else process.env.ADMIN_PIN = previousPin;
    if (previousVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = previousVercel;
  }
});

test('malformed Vercel request bodies return a client error', async () => {
  const request = {
    method: 'POST',
    url: '/api/join',
    headers: { host: 'localhost:3000' },
    get body() {
      throw new SyntaxError('invalid json');
    },
  };
  const response = makeResponse();
  await handleApiRequest(request, response, { store: new MemoryGameStore(QUESTIONS) });

  assert.equal(response.statusCode, 400);
  assert.match(JSON.parse(response.body).error, /格式/);
});

test('Vercel cannot be configured to use memory storage', () => {
  const previousStorage = process.env.QUIZ_STORAGE;
  const previousVercel = process.env.VERCEL;
  process.env.QUIZ_STORAGE = 'memory';
  process.env.VERCEL = '1';

  try {
    assert.throws(
      () => createGameStore(QUESTIONS),
      (error) => error.code === 'QUIZ_CONFIGURATION_ERROR' && error.status === 503,
    );
  } finally {
    if (previousStorage === undefined) delete process.env.QUIZ_STORAGE;
    else process.env.QUIZ_STORAGE = previousStorage;
    if (previousVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = previousVercel;
  }
});

test('health exposes missing Vercel storage configuration', async () => {
  const keys = [
    'QUIZ_STORAGE',
    'UPSTASH_REDIS_REST_URL',
    'UPSTASH_REDIS_REST_TOKEN',
    'KV_REST_API_URL',
    'KV_REST_API_TOKEN',
    'VERCEL',
  ];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  keys.forEach((key) => delete process.env[key]);
  process.env.VERCEL = '1';

  try {
    const result = await invoke(undefined, 'GET', '/api/health');
    assert.equal(result.status, 503);
    assert.match(result.body.error, /Redis/);
  } finally {
    keys.forEach((key) => {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    });
  }
});
