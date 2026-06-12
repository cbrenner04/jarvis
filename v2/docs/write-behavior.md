# Write behavior

`jarvis write` runs a resumable write loop: repeatedly calls `executeWrite` until
work is done, blocked, or the budget runs out. See [`state-store.md`](./state-store.md)
for durable run state and resume mechanics.

Current scope: real agent process spawning is not wired yet —
`createAgentBindings` (see [`shared-invocation.md`](./shared-invocation.md))
returns terminal-`error` bindings, so a live `jarvis write` reports
`invocation_failure`. The control flow (loop, contract dispatch, outcome routing,
state persistence) is exercised end-to-end in tests by injecting simulated
bindings (`v2/src/testing/bindings.ts`); no simulation lives in the production
CLI.

## Command

```
jarvis write \
  --project-root <repo-root> \
  --project <project-name> \
  --branch <branch-name> \
  --base <git-ref> \
  --spec <path-in-worktree> \
  --artifact <path-in-worktree> \
  [--agents <csv>] \
  [--max-iterations <n>]
```

- Worktree path: `~/.jarvis/worktrees/<project>/<branch>/`.
- Locking uses v1-compatible `.jarvis.lock` semantics, in a dedicated lock tree
  (`~/.jarvis/worktree-locks/<project>/<branch>/`) so the run serializes on the
  branch before its worktree exists.
- Resumable loop: `--max-iterations` is a per-invocation budget (default 10);
  no durable remaining-iterations counter. The loop consumes one iteration per
  `executeWrite` call.
- `--agents` is the ordered fallback list (default `claude`); the chain advances
  only on `quota`.

## Loop outcomes

The loop classifies and routes results:

- **`progress`**: agent did useful work, not finished. Loop continues, consuming
  one of `N`. Contract is **not** checked mid-loop.
- **`done` / `no-work`**: agent claims finished. Loop checks `--artifact`
  existence (contract); pass → success (`complete`), fail → append `## Blocker`
  to the spec and stop (`contract_miss`).
- **`blocked`**: agent is blocked. Loop stops immediately (terminal `blocked`,
  distinct from `contract_miss`).
- **Budget exhausted** while still `progress`: loop exits with a soft-stop outcome
  (distinct from `blocked`, marked resumable).
- **`invocation_failure`**: all agents exhausted / not wired. Terminal stop.

## Exit codes

- `0`: `complete` (success)
- `1`: `blocked` or `contract_miss` (blocked on agent or spec)
- `2`: `invocation_failure` (all agents failed)
- `5`: `budget-exhausted` (soft-stop, resumable per spec 02)

## Verification

Drive the path through the test seam:

- `bun test v2/src/write-loop.test.ts` proves the loop: repeated iterations,
  outcome routing, contract checks, blocker appending, state persistence, and
  cancellation via `AbortSignal`.
- `bun test v2/src/cli.test.ts` proves CLI arg parsing, agent forwarding, and
  exit-code mapping.

A live `jarvis write ...` runs the full pipeline and reports
`"kind": "invocation_failure"` until process bindings land.
