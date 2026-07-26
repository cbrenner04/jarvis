---
name: resume-refuses-the-review-row-it-advertises
---

# `run resume` refuses the `implement-review` row the docs say it accepts

## Problem

`jarvis run resume <implement-review-row>` hard-errors:

```text
resume_unsupported: step "implement-review" is not an executable write step
```

`v2/docs/operator-runbook.md` states the opposite, twice — that this was fixed and that resume on
such a row "now replays mutation re-verification, the ready gate, and publication without
re-invoking the completed write step's agent." It does not. The write step already committed, so
there is nothing to re-run in the write loop; the resume path rejects the row on step *kind* rather
than on whether a resumable tail exists.

Observed 2026-07-26 on run `0c81e851` (`20260726T205113Z-claim-refusal-precedes-stale-workspace-retirement`).

## Evidence

The row settled `surviving_mutation_failed` with `resumable: true` in its `loop_finished` record:

```json
{"kind":"loop_finished","loopOutcomeKind":"surviving_mutation_failed","iterationsConsumed":4,
 "resumable":true,"survivingMutation":"operator-flip: === → !==",
 "survivingMutationSourceFile":"v2/src/commands/cleanup.ts","survivingMutationSourceLine":149}
```

`jarvis run list` projected `unsupported_resume_context`, `resumable: false`, `nextAction: "stop"` —
honest about admission, but it contradicts both the log record and the documented recovery. Resume
then refused on step kind regardless.

## Decisions

- Resume admission for a durable review-behavior row keys on whether a resumable **tail** exists
  (mutation re-verification → ready gate → publication), not on whether the step is an executable
  write step. Rules out the current `isExecutableWriteStep` gate as the admission predicate.
- Resume on such a row must not re-invoke the completed write step's agent. Rules out falling back
  to a full workflow replay, which discards a green write step and its tokens.
- `list` / `wait` / the `loop_finished` record must agree on resumability for the same row. Rules
  out fixing admission while leaving the three surfaces contradicting each other — that
  disagreement is what made this look like two different bugs.
- Fix the runbook in the same change; it currently documents a recovery that does not exist. Rules
  out shipping the code fix without retiring the false instruction.

## Acceptance criteria

- [ ] `jarvis run resume` on a durable `implement-review` row that settled `surviving_mutation_failed`
      is admitted and replays mutation re-verification, the ready gate, and publication; a test
      drives that row and fails against the current `resume_unsupported` refusal.
- [ ] That resume does not invoke the write-step agent; a test asserts zero write-step invocations.
- [ ] A durable `review-debate` last step in the same state is admitted identically.
- [ ] `list`, `wait`, and the row's `loop_finished` record report the same `resumable` value for the
      same row; a test asserts agreement and fails if any surface diverges.
- [ ] The workflow entry id and a completed `~shrink` row still refuse for this scenario.
- [ ] Inverting the new admission predicate turns the resume test RED.

## Documentation updates

- `v2/docs/operator-runbook.md` § Gate trust and § Publication / completion failures — correct the
  claim that this case is already fixed; describe the real admission rule once it is.
- `v2/docs/daemon-host.md` — resume admission for durable review-behavior rows.
