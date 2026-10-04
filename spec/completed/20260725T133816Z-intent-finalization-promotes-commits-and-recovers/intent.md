---
name: intent-finalization-promotes-commits-and-recovers
---

# Intent finalization promotes the stage, commits, names its failures, and is recoverable

## Problem

`jarvis run workflow intent` writes split intents to `.jarvis-intent-stage/`, runs review, and then
leaves them there: no promotion to `<targetDir>/ready-intents/`, no stage/verdict cleanup, no commit.
Seven of nine intent runs on 2026-07-24/25 failed to promote; four were hand-recovered
(#2116, #2130, #2142, #2151), and two produced malformed PRs (#2108/#2111, recovered in #2109).

Three defects, one code path:

1. **No promotion.** The branch head sits at `origin/main` while finished, review-revised intents are
   on disk.
2. **Dishonest terminal records.** Run `71d3d7ef` recorded `boundary_committed` with
   `outcomeKind: "done"` / `runStatus: "completed"` while the committer produced no new commit and the
   stage was still populated. Run `02a33351` settled `loop_finished` `invocation_failure` while every
   role reported `exit_kind: "ok"` in `telemetry.jsonl` — blaming the agent for a post-invocation
   failure.
3. **No recovery.** `02a33351` reported `unsupported_resume_context` / `nextAction: "stop"`, so
   `run resume` refused and no other command promotes an existing stage. The only recovery was `find`
   plus hand-copying (#2109).

**The `completionAgent` hypothesis is refuted — do not plan against it.** The actuator ran with
`exit_kind: "ok"` in every one of the seven runs, failures included; staged-file count does not
separate them either. **The discriminator is unknown**, and two diagnoses of an adjacent failure have
already been wrong. Instrument first, observe one failure, then fix. The promotion behavior is wanted
regardless of the trigger.

**Occurrence #8 (2026-07-25, `intent/wedged-workflow-kill-needs-a-live-stall-`)** narrows where to
instrument. The review run settled `invocation_failure` **1.007 s** after the actuator returned
`exit_kind: "ok"` (actuator 13:17:52.775, `loop_finished` 13:17:53.782); the split, critic, and
actuator all reported `ok`. The failure is in the post-actuator finalization tail, not in any
invocation. A markdown-lint gate on the staged files is ruled out — both staged intents lint clean
against the repo config.

That incident also shows a **third** dishonest record, worse than the two below: the split run
(`c4485ef4`) settled a durable `failed` row whose reason, retryable, and `nextAction` are all
**empty**, while its own log holds `boundary_committed { outcomeKind: "done", runStatus: "completed" }`
and `loop_finished { loopOutcomeKind: "complete" }`. A `failed` row that names nothing at all must
also be covered.

## Decisions

- Finalization promotes every `.jarvis-intent-stage/*.md` to the durable `ready-intents/` directory,
  removes the stage directory and the verdict sidecars (`.jarvis-intent-review-verdict.md`,
  `.jarvis-intent-review-verdict.md.owner`), and commits. Rules out treating the stage as a durable
  output.
- Promotion runs whether or not the review actuator was invoked. Rules out gating publication on the
  actuator having produced revisions.
- Instrument the finalization path first: record which branch it takes and the reason it stops short
  of promotion, so one observed failure identifies the trigger. Rules out shipping a fix against an
  unidentified discriminator.
- A completion boundary reports the commit gap instead of `outcomeKind: "done"` /
  `runStatus: "completed"` when the committer produced no new commit and staged output remains, and
  names the uncommitted stage paths — the same contract the implement path enforces via
  `completion_commit_failed`. Rules out "completed with an unchanged branch head".
- A failure arising after all role invocations settles with an error naming the finalization step
  rather than `invocation_failure` when every role reported `exit_kind: "ok"`.
- A failed intent run whose stage is populated is recoverable without re-invoking the split or review
  agents: either `run resume` promotes the existing stage, or the failed row names a command that
  does. Recovery completes publication (promotion, cleanup, commit, push, PR), not just the file copy.
  Rules out `unsupported_resume_context` / `nextAction: "stop"` as the terminal answer when finished
  work is on disk.
- Out of scope: recovery for runs whose stage is empty or absent; why review roles settle
  `invocation_failure` on all-`ok` roles in *other* steps.

## Acceptance criteria

- [ ] An intent-workflow test whose split writes two staged intents and whose review roles all succeed
      asserts both files land in `ready-intents/`, the stage directory and both verdict sidecars are
      gone, and the branch has a new commit containing them; it fails against the pre-fix code.
- [ ] A test covering an approving (empty) critic verdict — no actuator invocation — asserts the same
      promotion, cleanup, and commit occur; it fails against the pre-fix code.
- [ ] The finalization path records which branch it took and why it stopped short of promotion.
- [ ] A test where the committer returns no new commit while staged files remain asserts the run does
      **not** record `outcomeKind: "done"` / `runStatus: "completed"` and names the uncommitted stage
      paths; inverting the guard fails the test.
- [ ] A test asserts a post-invocation finalization failure settles with an error naming the
      finalization step, not `invocation_failure`, when every role reported `exit_kind: "ok"`.
- [ ] No terminal `failed` row is emitted with an empty reason / retryable / `nextAction`; a test
      covering a row whose own log records `loop_finished complete` asserts the row either agrees with
      that record or names why it does not. Inverting the guard fails the test.
- [ ] A test drives an intent run to a finalization failure with a populated stage, then asserts the
      documented recovery command promotes the stage, cleans up the stage and verdict sidecars, and
      completes publication without invoking any split or review agent; it fails against pre-fix code.
- [ ] A test asserts the failed row for that run does not settle `unsupported_resume_context` /
      `nextAction: "stop"`, and instead surfaces the recovery path.

## Documentation updates

- `v2/docs/workflow-runner.md` — intent publication contract: the stage is transient, `ready-intents/`
  is the durable output, promotion is not conditional on actuation; boundary settlement contract
  (no `done` with an unchanged head and a populated stage; post-invocation failures named by step);
  resume/recovery semantics for a populated stage.
- `v2/docs/operator-runbook.md` § Recovery — recovering an intent run that failed with a populated
  stage.
- `v2/docs/v1-behaviors.md` — the changed intent-publication, settlement, and resume-gating behavior.

## Prerequisites

Plan this as three subspecs in dependency order: instrumentation + promotion, honest settlement,
recovery. Recovery depends on both.
