# AGENTS.md

## Cursor Cloud specific instructions

This repo is a single Cloudflare Workers app + read-only MCP server ("Cloudflare
Support Case Helper"). It serves a static browser app plus JSON APIs under
`/api/*`, a health check at `/health`, and a Streamable HTTP MCP endpoint at
`/mcp`. See `README.md` ("Local development", "Validate and deploy") for the
standard workflow; the npm scripts (`dev`, `test`, `typecheck`, `cf-typegen`,
`check:browser`, `check`) in `package.json` are the source of truth for commands.

### Running / testing services
- Dev server: `npm run dev` starts `wrangler dev` on `http://localhost:8787`
  (browser app at `/`, MCP at `/mcp`). Wrangler prints "Ready on ..." when up.
- The `AI` binding always uses a **remote** Cloudflare connection even in local
  dev (wrangler logs "Establishing remote connection"). Text-only issue analysis
  (`/api/analyze` without an image) and all case validation/drafting
  (`/api/case/*`) run fully locally and need **no** token or AI call.
- Screenshot analysis (`/api/analyze` with an image), the account/zone tools,
  and any Logpull/analytics/audit MCP tool require a real Cloudflare API token
  passed as the `X-Cloudflare-API-Token` header (never a tool argument). Without
  a token those specific paths cannot be exercised; the rest of the app can.

### Node version gotcha (non-obvious)
- `package.json` `engines` requires Node `>=22.18.0`. A **login** shell
  (e.g. `bash -l`, the tmux default here) auto-loads nvm, whose default is Node
  22.x and satisfies the engine. A non-login shell may resolve `node` to
  `/exec-daemon/node` (v22.14.0), which shadows nvm on `PATH`. `npm install` and
  the test suite work on either, but to match the engine range run under a login
  shell or `nvm use 22` (and prepend nvm's bin to `PATH` so it wins over
  `/exec-daemon/node`).

### Repo state note
- The application code currently lives on the feature branch, not on `main`
  (which holds only `README.md`). Set up / run from a branch that contains the
  app (e.g. this branch), not from an empty `main`.
