# Repository Instructions

## Scope

These instructions apply to the entire repository.

## Runtime boundaries

- Preserve the three public surfaces: `/`, `/admin`, and `/monitor`.
- Keep game rules in `lib/game-state.js`; do not duplicate state transitions in route wrappers or browser code.
- Keep HTTP behavior in `lib/quiz-api.js`; files under `api/` are Vercel entry-point adapters only.
- Vercel deployments MUST use Redis-backed state. Local `npm start` MAY use the in-memory store.
- Do not expose question answers in player-facing payloads.

## Configuration and secrets

- Treat `ADMIN_PIN`, Redis URLs, and Redis tokens as secrets or private configuration.
- Never commit `.env`, real credentials, or a deployment-specific token.
- Keep `PUBLIC_BASE_URL` configurable so preview deployments can use their own origin.
- Use a new `QUIZ_REDIS_PREFIX` for an independent event room.

## Verification

Run `npm test` after changes to game rules, API behavior, storage, or deployment routing. Run `node --check` for changed JavaScript files when syntax is affected. Verify local page/API smoke behavior when changing the local server or static routing.
