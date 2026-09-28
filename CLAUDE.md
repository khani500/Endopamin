# Edopamin (Server) — rules for Claude Code

## Production and PWA status
- Production is the Vercel project `endopamin` on branch `master`, serving www.endopamin.com. Both mobile apps call www.endopamin.com/api/*.
- The Vercel project `endopamin-pwa` (app.endopamin.com) has been paused since 2026-09-15. It is not production.
- `api/` is in scope: it is the backend the mobile apps use.
- The PWA client in `src/` gets no feature work. The PWA plan-generation path is closed and frozen; it reopens only by an explicit Resume decision from the founder.

## Ownership
- EndopaminRegistry owns resolver core and registry data. This repo only receives them through the Registry publisher; see "Resolver core freeze" below.

## Tests
- `npm test` runs `vitest run`. Vitest includes `src/**/*.test.{js,jsx,ts,tsx}` and `tests/**/*.test.{js,jsx,ts,tsx}` (`vitest.config.js`).
- Put test files in `tests/`, or next to their source under `src/` as `*.test.js`. Never put a test file in `api/`: Vercel turns every file in `api/` into a function unless its name starts with `_`.

## Seed residue
- A leftover `.core.seed-*` entry at the repo root is crash residue from the publisher's `--seed`, not managed core. Never commit it; remove it only after human review.

# Resolver core freeze

- `core/lib/plan/`, `core/data/` and `resolver-core-target.json` are publisher-owned. They are delivered only by EndopaminRegistry `scripts/publishRegistry.mjs`. Never edit, create, move or delete them by hand.
- No production code may import anything under `core/` until an explicit activation decision is made. This is enforced by `tests/resolver-core-import-guard.test.js`.
- The guard covers the Vercel production surface: `api/` and `src/`. `supabase/functions` (Deno edge functions) is deliberately out of scope because it is neither deployed by Vercel nor run by Vitest.
- `espree` is a test-only devDependency. Production code must never import it.
