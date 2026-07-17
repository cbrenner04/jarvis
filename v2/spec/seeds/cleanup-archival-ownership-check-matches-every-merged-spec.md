---
name: cleanup-archival-ownership-check-matches-every-merged-spec
---

# Cleanup archival's worktree-ownership check matches every merged spec (regression in #1719)

## Problem

`jarvis cleanup` archival (shipped in #1719) never clears the backlog. `hasMaterializedOwner`
(`v2/src/commands/cleanup.ts`) decides a spec is "owned by another materialized worktree" via:

```js
allWorktrees.some(wt => wt.path !== candidate && existsSync(join(wt.path, relative(projectRoot, spec.source))))
```

Every worktree is a **full repo checkout**, and every merged spec dir exists on `main`, so
`existsSync(<any-worktree>/v2/spec/<spec-dir>)` is **true for essentially every merged spec whenever
any worktree exists**. So archival skips ~every spec ("another materialized worktree owns this
spec") and moves nothing. Verified via `jarvis cleanup --dry-run` (2026-07-17): 17 specs flagged
owned, only 10 worktrees present, several flagged specs (#1701, #1681) have no dedicated worktree.

Root cause: conflates "a worktree's checkout contains this spec dir" (always true for merged specs)
with "a worktree is actively implementing this spec."

## Decisions

- Key ownership on the worktree's **branch** matching the spec (branch basename == spec dir name, or
  the active implement worktree for that spec), not `existsSync` of the dir in any checkout.
- Add a **real multi-worktree regression test** — the current tests mock `hasMaterializedOwner`
  (`async () => false/true`), so the real logic was never exercised (same class as
  `agent-authored-subprocess-mocks-assert-nothing-about-argv` + green-gate-is-not-evidence).

## Documentation updates

- `v2/docs/operator-runbook.md` — note archival works once this ships (backlog can be cleared).
