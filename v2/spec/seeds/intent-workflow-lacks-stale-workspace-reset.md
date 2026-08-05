---
name: intent-workflow-lacks-stale-workspace-reset
---

# A killed/failed intent poisons its branch; the next intent run fails non-retryably

`run workflow intent` (and the pipeline intent stage) is excluded from the
stale-workspace reset that `implement` and `plan` get. So an interrupted intent run
strands its worktree, branch, and `.jarvis-intent-review-verdict.md` — and the next
intent invocation on that branch reuses the poisoned tree. The review step then
refuses non-retryably:

```text
boundaryViolation: verdict file .jarvis-intent-review-verdict.md is owned by a different invocation
```

→ intent stage `harness_failure` (non-retryable) → pipeline `failed`. No self-recovery.

## Evidence

- 2026-08-05: a standalone `run workflow intent` on `intent/mutation-checkpoint-verifier-trust`
  was killed mid-flight; the leaked worktree kept a 0-byte verdict owned by that dead
  invocation. The full-review pipeline for the same seed then reused the worktree (its
  write step even committed on top of the killed run's commit), and its review step
  settled `invocation_failure` in ~4ms with the message above. Manual recovery:
  `jarvis cleanup --abandon intent/<slug> --yes`.
- Path-agnostic: standalone and pipeline intent share the same worktree/branch, so a
  standalone-then-pipeline (or any kill-then-rerun) on one slug reproduces it.

## Root cause

`STALE_RESET_WORKFLOWS` in `v2/src/commands/workflow.ts:269` is `new Set(["implement",
"plan"])`; `maybeResetStaleWorkspace` returns early for anything else
(`workflow.ts:280`). The exclusion comment ("intent stages its own tree") is only half
true: intent stages into `.jarvis-intent-stage/` **and** creates a persistent branch,
commits to it, and writes an ownership-stamped `.jarvis-intent-review-verdict.md`. So a
killed intent leaves exactly the persistent state the reset exists to retire.

## Decisions

- Add `"intent"` to `STALE_RESET_WORKFLOWS` so an incomplete git-enabled intent re-run
  retires the stale worktree/branch/verdict and rematerializes — same preflight as
  `implement`/`plan` (dirty-worktree gate, `--reset-despite-dirty`, etc.).
- Alternatively/additionally, the review-intent verdict-ownership guard
  (`review-intent-enforcement.ts`, the `boundaryViolation` above) should treat a marker
  owned by a **terminal/dead** invocation as reclaimable rather than refusing
  non-retryably. Prefer the stale-reset path for consistency; note this as a fallback if
  reset cannot cover the pipeline-stage dispatch (which does not go through the CLI
  `maybeResetStaleWorkspace`).
- Pipeline intent-stage materialization must get the same reset, since the CLI-layer
  `maybeResetStaleWorkspace` is not on the daemon stage-dispatch path.

## Acceptance criteria

- [ ] `STALE_RESET_WORKFLOWS` includes `"intent"`; a regression asserts membership and
      fails against the current two-element set.
- [ ] An incomplete git-enabled `run workflow intent` re-run over an existing worktree
      carrying a stale `.jarvis-intent-review-verdict.md` retires the worktree/branch and
      rematerializes before the write step; a regression seeds that state and asserts the
      reset ran (worktree removed + recreated, verdict gone).
- [ ] The pipeline intent stage performs the same stale reset on re-dispatch over a
      poisoned worktree (integration-level assertion, or a shared reset seam both paths
      call).
- [ ] Mutation checkpoint: a `// @mutate` directive reverting the set back to
      `{implement, plan}` (dropping `intent`) turns the membership regression RED; pin via
      a unique-basename test.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Recovery — record that a killed intent no longer
  strands a verdict marker once this ships; remove the manual `cleanup --abandon`
  workaround note for this case.

## Prerequisites

- `STALE_RESET_WORKFLOWS` / `maybeResetStaleWorkspace` (`v2/src/commands/workflow.ts`)
- `resetStaleWorkspace` (`v2/src/commands/cleanup.ts`)
- The verdict-ownership guard in `v2/src/execution/review-intent-enforcement.ts`
- The daemon pipeline intent-stage dispatch/materialization path
