const crypto = require('node:crypto');
const { Redis } = require('@upstash/redis');
const { createGameState } = require('./game-state');

const DEFAULT_PREFIX = 'anti-fraud-quiz';
const LOCK_TTL_SECONDS = 10;
const LOCK_RETRY_COUNT = 60;
const LOCK_RETRY_DELAY_MS = 50;

const RELEASE_LOCK_SCRIPT = `
  if redis.call('GET', KEYS[1]) == ARGV[1] then
    return redis.call('DEL', KEYS[1])
  end
  return 0
`;

function normalizeTransactionResult(result, fallbackState) {
  if (result && Object.prototype.hasOwnProperty.call(result, 'state')) {
    return {
      state: result.state,
      value: result.value,
    };
  }

  return { state: result || fallbackState, value: undefined };
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

class MemoryGameStore {
  constructor(questions) {
    this.kind = 'memory';
    this.state = createGameState(questions);
    this.mutationQueue = Promise.resolve();
  }

  async read() {
    await this.mutationQueue;
    return this.state;
  }

  async transact(mutator) {
    const operation = this.mutationQueue.then(async () => {
      const current = this.state;
      const result = normalizeTransactionResult(await mutator(current), current);
      this.state = result.state;
      return result;
    });

    this.mutationQueue = operation.catch(() => {});
    return operation;
  }
}

class RedisGameStore {
  constructor(questions, { redis, prefix = DEFAULT_PREFIX } = {}) {
    this.kind = 'redis';
    this.questions = questions;
    this.redis = redis || createRedisClient();
    this.stateKey = `${prefix}:state`;
    this.lockKey = `${prefix}:state-lock`;
  }

  async read() {
    const state = await this.redis.get(this.stateKey);
    return state || createGameState(this.questions);
  }

  async transact(mutator) {
    const token = crypto.randomUUID();
    await this.acquireLock(token);

    try {
      const current = (await this.redis.get(this.stateKey)) || createGameState(this.questions);
      const result = normalizeTransactionResult(await mutator(current), current);
      await this.redis.set(this.stateKey, result.state);
      return result;
    } finally {
      await this.releaseLock(token);
    }
  }

  async acquireLock(token) {
    for (let attempt = 0; attempt < LOCK_RETRY_COUNT; attempt += 1) {
      const acquired = await this.redis.set(this.lockKey, token, {
        nx: true,
        ex: LOCK_TTL_SECONDS,
      });

      if (acquired === 'OK' || acquired === true) return;
      await wait(LOCK_RETRY_DELAY_MS);
    }

    throw new Error('答题场当前较忙，请稍后重试');
  }

  async releaseLock(token) {
    try {
      await this.redis.eval(RELEASE_LOCK_SCRIPT, [this.lockKey], [token]);
    } catch {
      // The lock has a short TTL and will expire if the release request fails.
    }
  }
}

function getRedisConfig() {
  return {
    url: process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || '',
    token: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || '',
  };
}

function createRedisClient() {
  const { url, token } = getRedisConfig();
  if (!url || !token) {
    const error = new Error(
      'Vercel 环境缺少 Redis 配置，请设置 UPSTASH_REDIS_REST_URL 和 UPSTASH_REDIS_REST_TOKEN',
    );
    error.code = 'QUIZ_CONFIGURATION_ERROR';
    error.status = 503;
    throw error;
  }

  return new Redis({
    url,
    token,
    enableTelemetry: false,
  });
}

function isVercelRuntime() {
  return process.env.VERCEL === '1' || Boolean(process.env.VERCEL_ENV);
}

function createGameStore(questions) {
  const requestedMode = String(process.env.QUIZ_STORAGE || '').trim().toLowerCase();
  const prefix = String(process.env.QUIZ_REDIS_PREFIX || DEFAULT_PREFIX).trim() || DEFAULT_PREFIX;
  const vercelRuntime = isVercelRuntime();

  if (requestedMode === 'memory' && !vercelRuntime) {
    return new MemoryGameStore(questions);
  }

  if (vercelRuntime && requestedMode === 'memory') {
    const error = new Error('Vercel 部署必须使用 Redis，不能将 QUIZ_STORAGE 设置为 memory');
    error.code = 'QUIZ_CONFIGURATION_ERROR';
    error.status = 503;
    throw error;
  }

  if (requestedMode === 'redis' || vercelRuntime) {
    return new RedisGameStore(questions, { prefix });
  }

  return new MemoryGameStore(questions);
}

module.exports = {
  MemoryGameStore,
  RedisGameStore,
  createGameStore,
  getRedisConfig,
};
