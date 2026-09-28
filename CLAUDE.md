# Resolver core freeze

- `core/lib/plan/`, `core/data/` and `resolver-core-target.json` are publisher-owned. They are delivered only by EndopaminRegistry `scripts/publishRegistry.mjs`. Never edit, create, move or delete them by hand.
- No production code may import anything under `core/` until an explicit activation decision is made. This is enforced by `tests/resolver-core-import-guard.test.js`.
- The guard covers the Vercel production surface: `api/` and `src/`. `supabase/functions` (Deno edge functions) is deliberately out of scope because it is neither deployed by Vercel nor run by Vitest.
- `espree` is a test-only devDependency. Production code must never import it.
