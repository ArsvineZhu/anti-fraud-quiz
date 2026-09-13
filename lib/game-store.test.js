const test = require('node:test');
const assert = require('node:assert/strict');

const QUESTIONS = require('../data/questions');
const { addPlayer } = require('./game-state');
const { getRedisConfig, MemoryGameStore, RedisGameStore } = require('./game-store');

class FakeRedis {
  constructor() {
    this.values = new Map();
  }

  async get(key) {
    return this.values.get(key) ?? null;
  }

  async set(key, value, options = {}) {
    if (options.nx && this.values.has(key)) return null;
    this.values.set(key, value);
    return 'OK';
  }

  async eval(_script, keys, args) {
    const [key] = keys;
    const [token] = args;
    if (this.values.get(key) === token) {
      this.values.delete(key);
      return 1;
    }
    return 0;
  }
}

test('memory store serializes concurrent state transitions', async () => {
  const store = new MemoryGameStore(QUESTIONS);
  await Promise.all(Array.from({ length: 8 }, (_, index) => store.transact((state) => ({
    state: addPlayer(state, `同学${index + 1}`, index),
  }))));

  const state = await store.read();
  assert.equal(state.players.length, 8);
  assert.deepEqual(state.players.map((player) => player.id), [
    'player-1',
    'player-2',
    'player-3',
    'player-4',
    'player-5',
    'player-6',
    'player-7',
    'player-8',
  ]);
});

test('redis store persists state and releases its lock', async () => {
  const redis = new FakeRedis();
  const store = new RedisGameStore(QUESTIONS, { redis, prefix: 'quiz-test' });

  await store.transact((state) => ({
    state: addPlayer(state, '小林', 0),
  }));

  const state = await store.read();
  assert.equal(state.players.length, 1);
  assert.equal(state.players[0].name, '小林');
  assert.equal(await redis.get('quiz-test:state-lock'), null);
});

test('redis store preserves all players under concurrent writes', async () => {
  const store = new RedisGameStore(QUESTIONS, {
    redis: new FakeRedis(),
    prefix: 'quiz-concurrent-test',
  });

  await Promise.all(Array.from({ length: 8 }, (_, index) => store.transact((state) => ({
    state: addPlayer(state, `同学${index + 1}`, index),
  }))));

  const state = await store.read();
  assert.equal(state.players.length, 8);
  assert.equal(new Set(state.players.map((player) => player.id)).size, 8);
});

test('prefixed Vercel Upstash variables are accepted', () => {
  const keys = [
    'QUIZ_KV_REST_API_URL',
    'QUIZ_KV_REST_API_TOKEN',
    'UPSTASH_REDIS_REST_URL',
    'UPSTASH_REDIS_REST_TOKEN',
    'KV_REST_API_URL',
    'KV_REST_API_TOKEN',
  ];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  keys.forEach((key) => delete process.env[key]);
  process.env.QUIZ_KV_REST_API_URL = 'https://quiz.example.upstash.io';
  process.env.QUIZ_KV_REST_API_TOKEN = 'write-token';

  try {
    const config = getRedisConfig();
    assert.equal(config.url, 'https://quiz.example.upstash.io');
    assert.equal(config.token, 'write-token');
  } finally {
    keys.forEach((key) => {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    });
  }
});
