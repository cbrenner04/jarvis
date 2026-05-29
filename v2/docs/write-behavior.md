# Write behavior

`jarvis write` runs one `write` behavior turn.

Current scope: this CLI path is a walking skeleton. Real agent process spawning
is not wired yet — `createAgentBindings` (see
[`shared-invocation.md`](./shared-invocation.md)) returns terminal-`error`
bindings, so a live `jarvis write` reports `invocation_failure` and exits 1.
The control flow (worktree lifecycle, fallback, token parsing, contract
dispatch, result mapping) is exercised end-to-end in tests by injecting
simulated bindings (`v2/src/testing/bindings.ts`); no simulation lives in the
production CLI.

## Command

```
jarvis write \
  --project-root <repo-root> \
  --project <project-name> \
  --branch <branch-name> \
  --base <git-ref> \
  --spec <path-in-worktree> \
  --artifact <path-in-worktree> \
  [--agents <csv>]
```

- Worktree path: `~/.jarvis/worktrees/<project>/<branch>/`.
- Locking uses v1-compatible `.jarvis.lock` semantics, in a dedicated lock tree
  (`~/.jarvis/worktree-locks/<project>/<branch>/`) so the run serializes on the
  branch before its worktree exists.
- One invocation pass only; no automatic retry loop for `progress`.
- `--agents` is the ordered fallback list (default `claude`); the chain advances
  only on `quota`.

## Outcomes

- `done` / `no-work`: runner checks `--artifact` existence (a `no-work` claim
  still must prove the artifact is present).
- `progress`: surfaced as non-success; no contract check.
- `blocked`: surfaced as blocked; no contract check.
- Contract miss: surfaced as `contract_miss` (distinct from `blocked`).
- All agents exhausted / not wired: surfaced as `invocation_failure`.

## Verification

Until real bindings are wired, drive the path through the test seam rather than a
live shell run:

- `bun test v2/src/write.test.ts` proves the happy path, quota fallback, contract
  miss, `blocked`, and `progress` (no retry) using injected bindings.
- `bun test v2/src/cli.test.ts` proves CLI arg parsing, agent forwarding, and
  result→exit mapping, and that the default bindings report a not-wired error.

A live `jarvis write ...` runs the full pipeline and reports
`"kind": "invocation_failure"` until process bindings land.
