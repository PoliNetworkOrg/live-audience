# Agent instructions

See README.md for what the app is, how to run it and how activity types are structured.

- Node 24 runs `src/server` as TypeScript directly: only erasable syntax (no enums, no parameter
  properties, no namespaces) and relative imports with explicit `.ts`/`.tsx` extensions.
- The server must never import `*.tsx` or React: keep `src/activities/<type>/definition.ts` free of UI.
- New activity types go in `src/activities/<type>/` and are registered in both `registry.ts` and
  `ui-registry.ts`. Never rename an existing `type`: it is stored in the database.
- Database changes: append a new entry to `migrations` in `src/server/db.ts`, never edit old ones.
- Results returned by `aggregate` leave the app through the API key: keep personal data out.
- Before finishing: `pnpm typecheck && pnpm check && pnpm test`.

## Previewing

`cp .env.example .env && pnpm dev`, then open
`http://localhost:5173/auth/dev-login?as=admin&returnTo=/admin` (or `as=socio` / `as=guest`, plus
`&n=2` for another person). No IdP needed. `as=guest` is an account that is not a Socio; to try
guests, set "Who plays" to guests on a running presentation and open `/` in a private window.

## Commits

Conventional Commits (`feat:`, `fix:`, `docs:`, …).
