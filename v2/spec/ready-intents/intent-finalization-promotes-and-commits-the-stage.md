---
name: intent-finalization-promotes-and-commits-the-stage
---

# Intent finalization promotes the stage to `ready-intents/` and commits

## Problem

`jarvis run workflow intent` writes split intents to `.jarvis-intent-stage/`, runs review, and
then leaves them there: no promotion to `<targetDir>/ready-intents/`, no stage/verdict cleanup,
no commit. Observed 2026-07-24 on seed `tui-shows-a-live-window-not-fifty-rows` (runs `71d3d7ef`,
`02a33351`) with both review roles reporting `exit_kind: "ok"`; the branch head sat at
`origin/main` while the finished, review-revised intents were on disk. Third occurrence; two
earlier ones produced malformed PRs #2108/#2111, hand-recovered in #2109.

**The `completionAgent` hypothesis is refuted — do not plan against it.** This intent originally
suspected the post-review publication block was gated on the review step's `completionAgent`, set
only when the actuator runs, so an approving (empty) critic verdict would skip landing. Telemetry
across all seven intent runs of 2026-07-24/25 shows the actuator invoked with `exit_kind: "ok"` in
**every** one, failures included:

```text
FAILED  tui-shows-a-live-window        actuator dur=31319 ok  Composer 2.5
FAILED  live-daemons-are-invisible     actuator dur=89075 ok  claude-opus-5
ok      ready-gate-timeout-masquerades actuator dur=27165 ok  claude-opus-5
ok      intent-finalization-does-not-  actuator dur=12661 ok  claude-opus-5
FAILED  surviving-mutation-on-review   actuator dur=18578 ok  claude-opus-5
FAILED  review-actuator-deterministic  actuator dur=22526 ok  claude-sonnet-5
```

Six failures, two successes, same actuator profile; `ready-gate-timeout` (ok) and
`surviving-mutation` (failed) ran six minutes apart under identical conditions. Staged-file count
(2/3/4) does not separate them either. **The discriminator is unknown.** The runbook's standing
warning applies — two diagnoses of an adjacent failure have already been wrong; do not cut a third
against a guess. Instrument the finalization path to record which branch it took and why it stopped,
observe one failure with that instrumentation, then fix. The promotion behavior below is wanted
regardless of the trigger.

## Decisions

- Finalization promotes every `.jarvis-intent-stage/*.md` to the durable `ready-intents/`
  directory, removes the stage directory and the verdict sidecars
  (`.jarvis-intent-review-verdict.md`, `.jarvis-intent-review-verdict.md.owner`), and commits —
  rules out treating the stage as a durable output.
- Promotion runs whether or not the review actuator was invoked — rules out gating publication on
  the actuator having produced revisions. Note this no longer rests on the refuted
  `completionAgent` hypothesis; it is wanted on its own terms.
- Instrument the finalization path first: record which branch it takes and the reason it stops
  short of promotion, so one observed failure identifies the trigger. Rules out shipping a fix
  against an unidentified discriminator — six of eight runs failed with no distinguishing signal in
  telemetry.
- Out of scope: why review roles ever settle `invocation_failure` on all-`ok` roles in other steps.

## Acceptance criteria

- [ ] An intent-workflow test whose split writes two staged intents and whose review roles all
      succeed asserts both files land in `ready-intents/`, the stage directory and both verdict
      sidecars are gone, and the branch has a new commit containing them; it fails against the
      pre-fix code.
- [ ] A test covering an approving (empty) critic verdict — no actuator invocation — asserts the
      same promotion, cleanup, and commit occur; it fails against the pre-fix code.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — intent publication contract: the stage is transient,
  `ready-intents/` is the durable output, promotion is not conditional on actuation.
- `v2/docs/v1-behaviors.md` — record the changed intent-publication behavior.

## Prerequisites
