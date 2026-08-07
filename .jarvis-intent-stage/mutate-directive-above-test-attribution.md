---
name: mutate-directive-above-test-attribution
---

# A `// @mutate` directive above its `test(...)` line must link to that test, not the prior pin

The fix touches one module-boundary surface (execution loop), so splitting does not apply.

Distinct from `mutation-checkpoint-criterion-must-name-enclosing-test` (#2655): that is criterion naming the enclosing test; this is directive placement. Agents sometimes emit `// @mutate` one line above the `test("…", …)` declaration instead of inside the test body.

`enclosingPinTitle` scans backward from the directive line for the nearest `test`/`it` title. A directive above its intended test resolves to the previous test (or none), so `linkDirectivesToCriterion` cannot link it → hollow checkpoint → `contract_miss` even when the directive target text and criterion naming are correct.

Evidence: 2026-08-06 `pipeline-plan-stage-consumes-ready-intent` implement (#2667).

## Decisions

- `v1/docs/spec-guidance.md` § Mutation-checkpoint criteria MUST require the `// @mutate` comment inside the enclosing test body (below the `test("…", …) => {` line), not above it — rules out authoring guidance that omits placement while `enclosingPinTitle` still scans backward only.
- The write-step rules and/or plan-draft spec-guidance injection MUST carry the same inside-the-test-body placement rule — rules out implement agents learning placement only from durable docs they may not re-read.
- `v2/docs/operator-runbook.md` § Gate trust documents hollow-on-directive-above-test and the hand-fix (move the directive inside the test body), distinct from the criterion-omits-pin-title bullet — rules out operators treating linker miss as proof-form or criterion-naming failure.
- Plan time picks one: verifier attributes a directive whose nearest `test(...)` is on the immediately-following line to that test; OR a targeted diagnostic names "directive above its test" distinctly — rules out shipping both tolerance and a distinct diagnostic in one spec.
- Out of scope: criterion-naming rule (shipped in `mutation-checkpoint-criterion-must-name-enclosing-test`).

## Acceptance criteria

- [ ] Authoring guidance (`v1/docs/spec-guidance.md` § Mutation-checkpoint criteria) and/or the write-step directive instruct that `// @mutate` sits inside the enclosing test body; a doc assertion or lint covers the guidance presence.
- [ ] Either: the verifier attributes a directive whose nearest `test(...)` is on the immediately-following line to that test (regression: a directive one line above `test("X", …)` links to `X`, not the prior test); or a diagnostic names the "directive above its test" case distinctly. Pick one at plan time.
- [ ] Mutation checkpoint: a `// @mutate` directive (inside its test body) disabling the above-test attribution turns the regression RED.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v1/docs/spec-guidance.md` § Mutation-checkpoint criteria — directive placement (inside the test body).
- `v2/docs/operator-runbook.md` § Gate trust — hollow-on-directive-above-test failure mode and the hand-fix (move the directive inside the test body).
- `v2/docs/v1-behaviors.md` — record the chosen verifier attribution or diagnostic behavior.

## Prerequisites

- `enclosingPinTitle` scans backward from the directive line for the nearest enclosing `test`/`it` title and sets `directive.pinTitle` (`v2/src/execution/mutation-checkpoint-verifier.ts`).
- `linkDirectivesToCriterion` links a `// @mutate` directive to a criterion only when the criterion text contains the directive's pin title (no all-directives-in-file fallback).
