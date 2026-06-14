# Write behavior

`jarvis write` runs a resumable write loop: repeatedly calls `executeWrite` until
work is done, blocked, or the budget runs out. See [`state-store.md`](./state-store.md)
for durable run state and resume mechanics.

Kill-resume and crash-recovery are the same path: the loop never resumes
mid-step. Resume branches from durable state at the last committed boundary:

- Last attempt still `in-progress`: the prior invocation died mid-step, so the
  loop re-runs that same iteration over the existing dirty worktree.
- Run `status = "budget-soft-stopped"`: the prior invocation hit its
  per-invocation budget after a committed `progress` boundary, so the loop
  continues with a fresh budget.
- Run `status = "completed"` / `blocked` / `failed`: the last boundary already
  committed a terminal result, so re-invocation returns that durable result
  without creating a duplicate attempt or outcome.

Worktree reconstruction stays on the existing
[`withExternalWorktree`](../src/external-worktree.ts) path: if the stored
worktree directory is gone, the next iteration materializes it again from the
durable branch pointer before running.

The write prompt injects the v2 restraint principles (`write.principles`) at
every iteration; see [`coding-standards.md`](./coding-standards.md) for the
canonical principle text and rationale.

After a terminal `complete`, the loop may run one extra shrink step before it
returns. The loop first commits the completed boundary's worktree state, then
checks the run diff from the run-start base commit (`base..HEAD`). Empty diff:
skip shrink. Non-empty diff: run one more `executeWrite` call with the
`write.shrink` checklist as the step-rules string, scoped to that committed run
diff.

Shrink is best-effort and never gates an already-complete run:

- Clean shrink success (`done` / `no-work`, suite rerun green, no deleted test
  files in the shrink diff): keep the shrink edits and return `complete`.
- Any other shrink result (`blocked`, `progress`, `contract_miss`,
  `invocation_failure`, red suite, deleted test file): restore the worktree to
  the committed pre-shrink `HEAD` and still return `complete`.
- Crash mid-shrink: the run was already durably `completed`, so re-invocation
  restores committed `HEAD`, returns `complete`, and does not re-run shrink.

Acceptance-criteria non-regression is still prompt-only here. The mechanical
gate is limited to suite rerun plus deleted-test rejection.

Current scope: real agent process spawning is not wired yet.
`createAgentBindings` (see
[`shared-invocation.md`](./shared-invocation.md)) returns terminal-`error`
bindings, so a live `jarvis write` reports `invocation_failure` and exits 1.
The control flow (loop, contract dispatch, outcome routing, state persistence,
and resume) is exercised end-to-end in tests by injecting simulated bindings
(`v2/src/testing/bindings.ts`); no simulation lives in the production CLI.

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
  (distinct from `blocked`, marked resumable). Re-invoking the same run resumes
  remaining spec work with a fresh per-invocation budget.
- **`invocation_failure`**: all agents exhausted / not wired. Terminal stop.

Shrink runs only after the `done` / `no-work` path above resolves to terminal
`complete`. It never runs after `blocked`, `contract_miss`, `budget-exhausted`,
or `invocation_failure`, and it does not consume the normal iteration budget.

Resume identity is `(project, branch)` only. Re-invoking the same project and
branch resumes the most recent durable run even if `--base`, `--spec`, or the
materialized worktree path differ. A different project or branch creates a fresh
run.

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
