# Repository Instructions

## Scope

These instructions apply to the entire repository.

## Runtime boundaries

- Preserve the three public surfaces: `/`, `/admin`, and `/monitor`.
- Keep game rules in `lib/game-state.js`; do not duplicate state transitions in route wrappers or browser code.
- Keep HTTP behavior in `lib/quiz-api.js`; files under `api/` are Vercel entry-point adapters only.
- Every file under `api/` MUST delegate through `lib/vercel-handler.js` so hosted-runtime storage policy is explicit.
- Treat `local-server.js` as a local-development adapter only; Vercel MUST NOT depend on it.
- Vercel deployments MUST use Redis-backed state. Local `npm start` MAY use the in-memory store.
- Keep the number of JavaScript files under `api/` at or below 12 for Hobby deployments; reuse an existing function for health checks and similar metadata endpoints.
- Before a public event, `/api/health` MUST report `{ "ok": true, "storage": "redis" }`.
- Do not expose question answers in player-facing payloads.
- Player IDs are bearer tokens: generate them with cryptographic randomness and omit them from shared leaderboard/monitor projections.

## Configuration and secrets

- Treat `ADMIN_PIN`, Redis URLs, and Redis tokens as secrets or private configuration.
- Never commit `.env`, real credentials, or a deployment-specific token.
- Prefer the project-scoped `QUIZ_KV_REST_API_URL` and `QUIZ_KV_REST_API_TOKEN` names when Vercel adds the `QUIZ_` integration prefix; never substitute the read-only token for the write token.
- Keep `PUBLIC_BASE_URL` configurable so preview deployments can use their own origin.
- Use a new `QUIZ_REDIS_PREFIX` for an independent event room.

## Verification

Run `npm test` after changes to game rules, API behavior, storage, or deployment routing. Run `node --check` for changed JavaScript files when syntax is affected. Verify local page/API smoke behavior when changing the local server or static routing.
