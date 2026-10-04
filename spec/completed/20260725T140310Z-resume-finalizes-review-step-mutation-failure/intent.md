---
name: resume-finalizes-review-step-mutation-failure
---

# Resume finalizes a review-step mutation failure without re-running the write step

## Problem

Both documented recovery commands refuse a `surviving_mutation_failed` review step, so a finished,
pushed implementation stays a draft PR forever and the operator finalizes by hand (observed
2026-07-25, PR #2121):

```console
$ jarvis run resume 0b333fca…
resume_unsupported: step "implement-review" is not an executable write step
$ jarvis run resume 73b5f81a…        # the runbook's "resume the owning ~shrink row" fallback
terminal_run: Cannot resume a completed run
```

`reconstructWriteResume` (`v2/src/daemon/daemon.ts`) rejects `review` / `review-debate` behaviors
outright, but the failure is a post-write verification outcome, not a write-step failure. Fixing the
coverage gap — the documented remedy — changed nothing, because no command re-ran verification.

Distinct from `shrink-step-contract-miss-strands-the-run-terminally` (shrink `contract_miss` and
text-less shrink `blocked`).

## Decisions

- Resume of a `surviving_mutation_failed` review-step row re-runs mutation verification and
  finalization (ready gate, draft→ready flip) without re-invoking the completed write step. Rules out
  `resume_unsupported` on a non-write step when the failure is post-write, and rules out replaying the
  write iteration.
- Out of scope: whether `implement-review` should run mutation verification at all.

## Acceptance criteria

- [ ] `jarvis run resume` on a `surviving_mutation_failed` `implement-review` row completes
      finalization — re-verification, ready gate, draft→ready flip — without re-invoking the completed
      write step; inverting the admission guard fails the test.
- [ ] A test asserts no agent invocation occurs for the already-completed write step during that
      resume.
- [ ] A run whose review step succeeded is unaffected: it still settles `completed` and `resume` still
      refuses it as terminal.

## Documentation updates

- `v2/docs/operator-runbook.md` — § Gate trust and § Known gotchas: document the recovery that
  actually works for a review-step mutation failure.
- `v2/docs/daemon-host.md` — the `resume` RPC row: review-behavior steps admit resume for post-write
  verification failures.

## Prerequisites

Land order (sibling batch): `surviving-mutation-row-honest-on-any-step` →
`resume-admits-every-row-it-calls-resumable` → this intent. Both are merged on `main` in this
worktree.

- `surviving_mutation_failed` on a review step settles a durable `failed` row with `nextAction: "resume"` and the mutation/file/line details (`v2/spec/completed/20260725T012538Z-surviving-mutation-row-honest-on-any-step/`)
- `run resume` admits every row advertising `resumable: true` (`v2/spec/20260725T013213Z-resume-admits-every-row-it-calls-resumable/`, merged)
