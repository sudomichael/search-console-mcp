# Handoff
## Goal
Publish search-console-mcp-server 0.2.3 (mcpserverlist.io note) to npm, tag v0.2.3.
## State
0.2.3 committed and pushed. Build + 24 tests green (11-08). Publish NOT done: `npm whoami` returns 401 (no npm login or token on this machine; no CI workflow, no .npmrc). npm still shows 0.2.2. Tag v0.2.3 not created yet (held until publish works).
## Next 3
1. Owner runs `npm login` (or provides an automation token), then `npm publish` in this repo.
2. Verify: `npm view search-console-mcp-server version` = 0.2.3.
3. `git tag v0.2.3 && git push origin v0.2.3`.
## Blockers
npm auth missing in agent environment.
## Owner approvals
Publish of 0.2.3 approved 11-08; only credentials missing.
