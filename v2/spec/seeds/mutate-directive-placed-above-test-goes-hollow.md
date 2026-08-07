---
name: mutate-directive-placed-above-test-goes-hollow
---

# A `// @mutate` directive placed above the `test(...)` line links to the wrong test and goes hollow

Distinct from `mutation-checkpoint-criterion-must-name-enclosing-test` (landed #2655), which is about the **criterion** naming the enclosing test. This is about **directive placement**: agents sometimes emit the `// @mutate` comment on the line *above* the `test("…", …)` declaration instead of inside the test body.

## Problem

`enclosingPinTitle` (`v2/src/execution/mutation-checkpoint-verifier.ts`) scans **backward** from the directive line for the nearest enclosing `test`/`it` title. A directive placed above its intended `test(...)` line resolves to the *previous* test (or none), so `linkDirectivesToCriterion` cannot link it to the criterion → the checkpoint is reported `hollow` and the run settles `contract_miss` ("no @mutate directive linked to this criterion") — even though the directive's target text and the criterion's naming are both correct.

## Evidence

- 2026-08-06, `pipeline-plan-stage-consumes-ready-intent` implement (#2667): the agent placed `// @mutate …publication-workflow-steps.ts "paths: [resolve(project.root, input.readyIntent)]," -> …` one line **above** `test("pipeline plan stage landing deletes consumed ready-intent from plan worktree", …)`. Blocked on `contract_miss` / hollow. Operator moved the directive inside the test body; the linker then resolved it and the mutation reddened the test (0→1 fail).

## Decisions

- The write-step prompt directive (and `v1/docs/spec-guidance.md` § Mutation-checkpoint criteria) must state the `// @mutate` comment goes **inside** the enclosing test body (below the `test("…", …) => {` line), not above it — because `enclosingPinTitle` scans backward and a directive above the test links to the wrong pin.
- Consider making the verifier tolerant: if a directive's nearest enclosing test is on the line immediately below it (not above), still attribute it to that test — or emit a targeted diagnostic distinguishing "directive above its test" from a genuinely missing directive.
- Out of scope: the criterion-naming rule (already shipped in `mutation-checkpoint-criterion-must-name-enclosing-test`).

## Acceptance criteria

- [ ] Authoring guidance (`v1/docs/spec-guidance.md` § Mutation-checkpoint criteria) and/or the write-step directive instruct that `// @mutate` sits inside the enclosing test body; a doc assertion or lint covers the guidance presence.
- [ ] Either: the verifier attributes a directive whose nearest `test(...)` is on the immediately-following line to that test (regression: a directive one line above `test("X", …)` links to `X`, not the prior test); or a diagnostic names the "directive above its test" case distinctly. Pick one at plan time.
- [ ] Mutation checkpoint (if a verifier guard is added): a `// @mutate` directive (inside its test body) disabling the above-test attribution turns the regression RED.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v1/docs/spec-guidance.md` § Mutation-checkpoint criteria — directive placement (inside the test body).
- `v2/docs/operator-runbook.md` § Gate trust — hollow-on-directive-above-test failure mode and the hand-fix (move the directive inside the test body).

## Prerequisites

- `enclosingPinTitle` / `linkDirectivesToCriterion` (`v2/src/execution/mutation-checkpoint-verifier.ts`).
