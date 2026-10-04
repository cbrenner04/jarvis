# Structural guard prevents Git/GitHub command spawning bypass

Land a `scripts/guard-git-spawn-bypass.ts` check that forbids direct `runAsync("git"` / `runAsync("gh"` in `v2/src` production modules except the GitHub boundary owner, clear the remaining inline spawn sites prerequisites left in daemon/commands and execution, then wire the guard into `bun run check` and document the exception process.

Prerequisites (intent): `shared-git-operations-boundary`, `github-operations-boundary`, `cleanup-delegates-to-git-boundary`, `external-worktree-delegates-to-shared`, `review-implement-uses-shared-diff`, `root-scripts-use-shared-git` — confirmed in tree (`shared/git.ts`, `github-operations.ts`, `cleanup.ts` without inline spawns, `external-worktree.ts` + `review-implement.ts` delegating, `scripts/ready.ts` via `gitDir`).

- [x] [00-guard-git-spawn-bypass-script.md](./00-guard-git-spawn-bypass-script.md) — exported scanner, co-located tests, allowlisted `github-operations.ts` `gh` owner, per-call `guard-git-spawn-bypass:` marker
- [x] [01-migrate-daemon-and-commands-inline-spawns.md](./01-migrate-daemon-and-commands-inline-spawns.md) — zero forbidden spawns under `v2/src/commands/` and `v2/src/daemon/` production modules
- [x] [02-migrate-execution-inline-git-gh-spawns.md](./02-migrate-execution-inline-git-gh-spawns.md) — zero forbidden spawns under `v2/src/execution/` except `github-operations.ts`
- [x] [03-wire-check-and-document-guard.md](./03-wire-check-and-document-guard.md) — `package.json` `check`, ready-script pin, `AGENTS.md`, `v2/docs/v2-architecture.md`
