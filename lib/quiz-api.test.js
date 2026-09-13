const test = require('node:test');
const assert = require('node:assert/strict');

const {
  startGame,
  syncRoomState,
} = require('./game-state');
const { MemoryGameStore } = require('./game-store');
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
