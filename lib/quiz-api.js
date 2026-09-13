const QRCode = require('qrcode');

const QUESTIONS = require('../data/questions');
const {
  QUESTION_TIME_LIMIT_MS,
  addPlayer,
  createGameState,
  endGame,
  getMonitorSnapshot,
  rankPlayers,
  recordAnswer,
  removePlayer,
  startGame,
  syncRoomState,
} = require('./game-state');
const { createGameStore } = require('./game-store');

const COUNTDOWN_MS = 3000;
const QUESTION_COUNT = 15;

let defaultStore;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function getStore(providedStore) {
  if (providedStore) return providedStore;
  if (!defaultStore) defaultStore = createGameStore(QUESTIONS);
  return defaultStore;
}

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

function getHeader(req, name) {
  const value = req.headers?.[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function getRequestUrl(req) {
  const forwardedHost = getHeader(req, 'x-forwarded-host');
  const host = forwardedHost || getHeader(req, 'host') || 'localhost:3000';
  const protocol = getHeader(req, 'x-forwarded-proto') || 'http';
  return new URL(req.url || '/', `${protocol}://${host}`);
}

function getBaseUrl(req) {
  const configured = String(process.env.PUBLIC_BASE_URL || '').trim();
  if (configured) return configured.replace(/\/+$/, '');

  const requestUrl = getRequestUrl(req);
  return requestUrl.origin;
}

function readJsonBody(req) {
  if (req.body !== undefined) {
    if (req.body === null) return Promise.resolve({});
    if (typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return Promise.resolve(req.body);

    const text = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body);
    try {
      const parsed = text ? JSON.parse(text) : {};
      return Promise.resolve(parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {});
    } catch {
      return Promise.reject(new HttpError(400, '请求数据格式不正确'));
    }
  }

  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new HttpError(413, '请求内容过大'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new HttpError(400, '请求数据格式不正确'));
      }
    });
    req.on('error', reject);
  });
}

function syncState(state, now = Date.now()) {
  let next = syncRoomState(state, now);
  if (
    next.status === 'running' &&
    next.players.length > 0 &&
    next.players.every((player) => player.completed)
  ) {
    next = endGame(next, now);
  }
  return next;
}

function safeQuestions(questions) {
  return questions.map(({ answer, ...rest }) => rest);
}

function getPlayer(state, playerId) {
  return state.players.find((player) => player.id === playerId) || null;
}

function publicPlayer(player) {
  if (!player) return null;
  return {
    id: player.id,
    name: player.name,
    score: player.score,
    answered: player.answeredQuestionIds.length,
    total: player.assignedQuestionIds.length,
    elapsedMs: player.elapsedMs,
    completed: player.completed,
  };
}

function getPlayerQuestions(state, player) {
  if (!player) return [];
  const assignedIds = new Set(player.assignedQuestionIds);
  return safeQuestions(state.questions.filter((question) => assignedIds.has(question.id)))
    .sort((a, b) => player.assignedQuestionIds.indexOf(a.id) - player.assignedQuestionIds.indexOf(b.id));
}

function getRoomPayload(state, req, playerId = '') {
  const player = getPlayer(state, playerId);
  const now = Date.now();
  return {
    status: state.status,
    started: state.started,
    completed: state.completed,
    startedAt: state.startedAt,
    countdownEndsAt: state.countdownEndsAt,
    countdownRemainingMs: state.countdownEndsAt
      ? Math.max(0, state.countdownEndsAt - now)
      : 0,
    endedAt: state.endedAt,
    questionCount: QUESTION_COUNT,
    questionTimeLimitMs: QUESTION_TIME_LIMIT_MS,
    accessUrl: `${getBaseUrl(req)}/`,
    player: publicPlayer(player),
    questions: getPlayerQuestions(state, player),
    players: getLeaderboard(state),
  };
}

function getLeaderboard(state) {
  return rankPlayers(state.players).map((player, index) => ({
    rank: index + 1,
    id: player.id,
    name: player.name,
    score: player.score,
    answered: player.answeredQuestionIds.length,
    total: player.assignedQuestionIds.length,
    elapsedMs: player.elapsedMs,
  }));
}

function getAdminPayload(state, req) {
  return {
    ...getRoomPayload(state, req),
    monitor: getMonitorSnapshot(state),
    adminPinRequired: true,
  };
}

function getAdminPin(req, body, requestUrl) {
  return String(
    getHeader(req, 'x-admin-pin') || body.pin || requestUrl.searchParams.get('pin') || '',
  ).trim();
}

function requireAdmin(req, body, requestUrl) {
  const configuredPin = String(process.env.ADMIN_PIN || '').trim();
  const isVercel = process.env.VERCEL === '1' || Boolean(process.env.VERCEL_ENV);

  if (isVercel && !configuredPin) {
    throw new HttpError(503, '管理员口令尚未配置，请在 Vercel 环境变量中设置 ADMIN_PIN');
  }

  const expectedPin = configuredPin || '2026';
  if (getAdminPin(req, body, requestUrl) !== expectedPin) {
    throw new HttpError(401, '管理员口令不正确');
  }
}

function getMeta(req) {
  const baseUrl = getBaseUrl(req);
  return {
    title: '智识反诈',
    questionCount: QUESTIONS.length,
    assignedQuestionCount: QUESTION_COUNT,
    questionTimeLimitMs: QUESTION_TIME_LIMIT_MS,
    countdownMs: COUNTDOWN_MS,
    accessUrl: `${baseUrl}/`,
    adminUrl: `${baseUrl}/admin`,
    monitorUrl: `${baseUrl}/monitor`,
  };
}

function getAnswerChoice(body) {
  if (body.choiceIndex === null || body.choiceIndex === undefined || body.choiceIndex === '') {
    return null;
  }
  return Number(body.choiceIndex);
}

async function handleApiRequest(req, res, { store } = {}) {
  const requestUrl = getRequestUrl(req);
  if (!requestUrl.pathname.startsWith('/api/')) return false;

  try {
    if (req.method === 'GET' && requestUrl.pathname === '/api/meta') {
      sendJson(res, 200, getMeta(req));
      return true;
    }

    if (req.method === 'GET' && requestUrl.pathname === '/api/qr') {
      const text = requestUrl.searchParams.get('text') || '';
      if (!text) throw new HttpError(400, '二维码内容不能为空');

      const dataUrl = await QRCode.toDataURL(text, {
        width: 220,
        margin: 1,
        errorCorrectionLevel: 'M',
      });
      sendJson(res, 200, { dataUrl });
      return true;
    }

    const activeStore = getStore(store);

    if (req.method === 'GET' && requestUrl.pathname === '/api/health') {
      await activeStore.read();
      sendJson(res, 200, { ok: true, storage: activeStore.kind });
      return true;
    }

    if (req.method === 'GET' && requestUrl.pathname === '/api/room') {
      const playerId = requestUrl.searchParams.get('playerId') || '';
      const state = syncState(await activeStore.read());
      sendJson(res, 200, getRoomPayload(state, req, playerId));
      return true;
    }

    if (req.method === 'GET' && requestUrl.pathname === '/api/leaderboard') {
      const state = syncState(await activeStore.read());
      sendJson(res, 200, { players: getLeaderboard(state) });
      return true;
    }

    if (req.method === 'GET' && requestUrl.pathname === '/api/monitor') {
      const state = syncState(await activeStore.read());
      sendJson(res, 200, {
        ...getMonitorSnapshot(state),
        questionCount: QUESTION_COUNT,
        questionTimeLimitMs: QUESTION_TIME_LIMIT_MS,
        serverTime: Date.now(),
      });
      return true;
    }

    if (req.method === 'GET' && requestUrl.pathname === '/api/admin/room') {
      requireAdmin(req, {}, requestUrl);
      const state = syncState(await activeStore.read());
      sendJson(res, 200, getAdminPayload(state, req));
      return true;
    }

    if (req.method === 'POST' && requestUrl.pathname === '/api/join') {
      const body = await readJsonBody(req);
      const name = String(body.name || '').trim().slice(0, 16) || '匿名同学';
      const playerId = String(body.playerId || '').trim();
      const result = await activeStore.transact((state) => {
        const next = syncState(state);
        const existing = playerId ? getPlayer(next, playerId) : null;

        if (existing) {
          return { state: next, value: getRoomPayload(next, req, existing.id) };
        }

        if (next.status !== 'waiting') {
          throw new HttpError(409, '本局已经开始，暂时不能加入');
        }

        const updated = addPlayer(next, name, Date.now());
        const player = updated.players[updated.players.length - 1];
        return { state: updated, value: getRoomPayload(updated, req, player.id) };
      });
      sendJson(res, 200, result.value);
      return true;
    }

    if (req.method === 'POST' && requestUrl.pathname === '/api/leave') {
      const body = await readJsonBody(req);
      const playerId = String(body.playerId || '').trim();
      const result = await activeStore.transact((state) => {
        const next = syncState(state);
        const player = getPlayer(next, playerId);
        if (!player) return { state: next, value: { ok: true, removed: false } };
        if (next.status !== 'waiting') {
          throw new HttpError(409, '游戏开始后不能退出，请联系管理员重置本局');
        }
        return {
          state: removePlayer(next, playerId),
          value: { ok: true, removed: true },
        };
      });
      sendJson(res, 200, result.value);
      return true;
    }

    if (req.method === 'POST' && requestUrl.pathname === '/api/answer') {
      const body = await readJsonBody(req);
      const playerId = String(body.playerId || '').trim();
      const questionId = Number(body.questionId);
      const choiceIndex = getAnswerChoice(body);
      const elapsedMs = Number(body.elapsedMs || 0);
      const result = await activeStore.transact((state) => {
        const next = syncState(state);
        const before = getPlayer(next, playerId);

        if (!before) throw new HttpError(404, '参赛记录不存在');
        if (next.status !== 'running') {
          throw new HttpError(409, '管理员还没有开始答题，或本局已经结束');
        }

        const question = next.questions.find((item) => item.id === questionId);
        if (!question) throw new HttpError(400, '题目不存在');
        if (!before.assignedQuestionIds.includes(questionId)) {
          throw new HttpError(400, '这道题不属于你的答题序列');
        }
        if (before.answeredQuestionIds.includes(questionId)) {
          throw new HttpError(409, '这道题已经提交过了');
        }

        const boundedElapsedMs = Math.max(
          0,
          Math.min(Number.isFinite(elapsedMs) ? elapsedMs : 0, QUESTION_TIME_LIMIT_MS),
        );
        let updated = recordAnswer(next, playerId, questionId, choiceIndex, boundedElapsedMs);
        const after = getPlayer(updated, playerId);
        const accepted = after.answeredQuestionIds.length > before.answeredQuestionIds.length;
        if (accepted && updated.players.every((player) => player.completed)) {
          updated = endGame(updated, Date.now());
        }

        return {
          state: updated,
          value: {
            accepted,
            correct: choiceIndex !== null && choiceIndex === question.answer,
            correctIndex: question.answer,
            player: {
              id: after.id,
              name: after.name,
              score: after.score,
              answered: after.answeredQuestionIds.length,
              elapsedMs: after.elapsedMs,
            },
            players: getLeaderboard(updated),
            tip: question.tip,
          },
        };
      });
      sendJson(res, 200, result.value);
      return true;
    }

    if (req.method === 'POST' && requestUrl.pathname === '/api/admin/start') {
      const body = await readJsonBody(req);
      requireAdmin(req, body, requestUrl);
      const result = await activeStore.transact((state) => {
        const next = syncState(state);
        if (next.status !== 'waiting') throw new HttpError(409, '当前房间不是等待状态');
        if (!next.players.length) throw new HttpError(409, '至少需要一名同学加入后才能开始');
        const updated = startGame(next, Date.now(), COUNTDOWN_MS);
        return { state: updated, value: getAdminPayload(updated, req) };
      });
      sendJson(res, 200, result.value);
      return true;
    }

    if (req.method === 'POST' && requestUrl.pathname === '/api/admin/end') {
      const body = await readJsonBody(req);
      requireAdmin(req, body, requestUrl);
      const result = await activeStore.transact((state) => {
        const next = syncState(state);
        const updated = endGame(next, Date.now());
        return { state: updated, value: getAdminPayload(updated, req) };
      });
      sendJson(res, 200, result.value);
      return true;
    }

    if (req.method === 'POST' && requestUrl.pathname === '/api/admin/reset') {
      const body = await readJsonBody(req);
      requireAdmin(req, body, requestUrl);
      const result = await activeStore.transact(() => {
        const updated = createGameStateForReset();
        return { state: updated, value: getAdminPayload(updated, req) };
      });
      sendJson(res, 200, result.value);
      return true;
    }

    sendJson(res, 404, { error: '接口不存在' });
    return true;
  } catch (error) {
    const isConfigurationError = error?.code === 'QUIZ_CONFIGURATION_ERROR';
    const status = error instanceof HttpError ? error.status : error?.status || 500;
    if (!(error instanceof HttpError) && !isConfigurationError) console.error('[quiz api]', error);
    sendJson(res, status, {
      error: error instanceof HttpError || isConfigurationError
        ? error.message
        : '服务暂时不可用，请稍后重试',
    });
    return true;
  }
}

function createGameStateForReset() {
  return createGameState(QUESTIONS, Date.now());
}

module.exports = {
  COUNTDOWN_MS,
  QUESTION_COUNT,
  handleApiRequest,
};
