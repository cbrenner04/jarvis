# A surviving mutation on the review step strands the run with no recovery path

## Problem

When `surviving_mutation_failed` settles on an `implement-review` step, the run reports durable
`completed`, its PR stays draft forever, and **both** documented recovery commands refuse. The
implementation is finished and pushed; nothing in the harness will finalize it.

The runbook promises otherwise on two counts, and both are wrong for this step:

- [Gate trust](../../docs/operator-runbook.md) — "resume a `ready_gate_failed` or
  `surviving_mutation_failed` run after fixing coverage."
- [Known gotchas](../../docs/operator-runbook.md) — "a run ending `surviving_mutation_failed`
  settles `failed` on `run list` / `run wait` with … `nextAction: "resume"`. `run resume` accepts
  that row."

## Evidence

2026-07-25, spec `20260724T225946Z-write-loop-progress-extended-iteration-wall`, PR #2121.

```console
$ jarvis run log 0b333fca…            # step_id: implement-review
{"kind":"loop_finished","loopOutcomeKind":"surviving_mutation_failed","iterationsConsumed":8,
 "resumable":true,"survivingMutation":"operator-flip: !== → ===",
 "survivingMutationSourceFile":"shared/invocation/agents.ts","survivingMutationSourceLine":56}

$ jarvis run list | grep 0b333fca     # reports completed, no error columns at all
0b333fca…  jarvis  20260724T225946Z-write-loop-…  completed  not-live  -  -  -  …

$ jarvis run resume 0b333fca…
resume_unsupported: step "implement-review" is not an executable write step

$ jarvis run resume 73b5f81a…        # the runbook's "resume the owning ~shrink row" fallback
terminal_run: Cannot resume a completed run
```

The mutation was a true coverage gap (the `onOutputProgress` passthrough in
`shared/invocation/agents.ts` had no committed test). Fixing coverage — the documented remedy — did
not help, because no command would re-run the verification. The operator finalized the PR by hand.

Distinct from `shrink-step-contract-miss-strands-the-run-terminally`, which covers shrink
`contract_miss` and text-less shrink `blocked`, not mutation verification on the review step.

**A second outcome refuses the same way**, so this is a class, not one reason. Same session, spec
`20260724T230804Z-tui-limits-terminal-rows-to-one-hour` (PR #2123):

```console
$ jarvis run log b1d7ba2b…
{"kind":"loop_finished","loopOutcomeKind":"ready_gate_failed","iterationsConsumed":5,"resumable":true}

$ jarvis run resume b1d7ba2b…
terminal_run: Cannot resume a failed run
```

The runbook says "resume a `ready_gate_failed` … run after fixing coverage", and the row itself
reports `resumable: true` — both contradicted by the refusal. Treat `resumable` on the row and
admission by `run resume` as one contract to fix together.

## Decisions

- A `surviving_mutation_failed` run must settle durable `failed` with `error.reason:
  "surviving_mutation_failed"`, `retryable: true`, and the surviving mutation, source file, and line
  on the row — regardless of which step produced it. Rules out the observed bare `completed` row that
  hides a failure from `run list` entirely.
- `jarvis run resume` must admit that row and re-run mutation verification plus finalization without
  re-invoking the completed write step. Rules out `resume_unsupported` on a non-write step when the
  failure is a post-write verification outcome.
- If resume genuinely cannot own review-step recovery, the refusal must name the command that can;
  rules out two refusals that each point at the other.
- Correct both runbook claims above in the same change — they describe behavior the harness does not
  have. Rules out leaving documentation that sends the next operator down a dead end.
- Out of scope: reducing the mutation-verification miss rate, and whether `implement-review` should
  run mutation verification at all.

## Acceptance criteria

- [ ] A test drives `surviving_mutation_failed` on an `implement-review` step and asserts the durable
      row is `failed` with `error.reason: "surviving_mutation_failed"`, `retryable: true`, and the
      mutation/file/line populated; it fails against the pre-fix code, which reports `completed`.
- [ ] `jarvis run resume` admits that row and completes finalization (re-verification, ready gate,
      draft→ready flip) without re-invoking the completed write step; inverting the admission guard
      fails the test.
- [ ] A `ready_gate_failed` run reporting `resumable: true` is admitted by `jarvis run resume`; it
      fails against the pre-fix code, which refuses `terminal_run: Cannot resume a failed run`.
- [ ] No row reports `resumable: true` while `run resume` refuses it — assert the two agree across
      every terminal outcome kind, so a future outcome cannot reintroduce the split.
- [ ] A run whose review step succeeded is unaffected: it still settles `completed` and `resume`
      still refuses it as terminal.
- [ ] `v2/docs/operator-runbook.md` no longer claims `surviving_mutation_failed` always settles
      `failed`/resumable without qualification, and documents the recovery that actually works.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — § Gate trust and § Known gotchas: correct the resume claims and
  give the working recovery for a review-step mutation failure.
- `v2/docs/daemon-host.md` — the operator-error row for `surviving_mutation_failed` and which steps
  admit resume.

## Prerequisites

None.
