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

Suspected seam: the post-review publication block is gated on the review step's
`completionAgent`, which is set only when the review actuator runs. An approving (empty) critic
verdict skips actuation, so landing, commit, push, and PR are all skipped.

## Decisions

- Finalization promotes every `.jarvis-intent-stage/*.md` to the durable `ready-intents/`
  directory, removes the stage directory and the verdict sidecars
  (`.jarvis-intent-review-verdict.md`, `.jarvis-intent-review-verdict.md.owner`), and commits —
  rules out treating the stage as a durable output.
- Promotion runs whether or not the review actuator was invoked — rules out gating publication on
  the actuator having produced revisions.
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
