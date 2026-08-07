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
- `DEFAULT_WRITE_STEP_RULES` / implement `STEP_RULES` MUST carry the same inside-the-test-body placement rule — implement does not inject spec-guidance, so write-step is the implement contract.
- Plan time picks one: verifier attributes a directive whose nearest `test(...)` is on the immediately-following line to that test; OR a targeted diagnostic names "directive above its test" distinctly — rules out shipping both tolerance and a distinct diagnostic in one spec.
- Operator docs branch on that pick: tolerance → `v2/docs/operator-runbook.md` § Gate trust and `v2/docs/v1-behaviors.md` document inside-the-test-body as authoring preference only (no hollow-on-directive-above-test failure mode); diagnostic → same surfaces document hollow-on-directive-above-test and the hand-fix (move the directive inside the test body), distinct from the criterion-omits-pin-title bullet.
- Out of scope: criterion-naming rule (shipped in `mutation-checkpoint-criterion-must-name-enclosing-test`).

## Acceptance criteria

- [ ] Both `v1/docs/spec-guidance.md` § Mutation-checkpoint criteria and write-step rules (`DEFAULT_WRITE_STEP_RULES` / implement `STEP_RULES`) instruct that `// @mutate` sits inside the enclosing test body; a doc assertion or lint covers both surfaces.
- [ ] Either: `mutation-checkpoint-verifier.test.ts` proves a directive one line above `test("X", …)` links to `X` (not the prior test) via forward-line attribution, and that test fails against pre-fix backward-only scan; or: a distinct "directive above its test" diagnostic is emitted, with a regression in `mutation-checkpoint-verifier.test.ts` that fails pre-fix and passes after. Pick one at plan time.
- [ ] If the tolerance branch ships: mutation checkpoint in `mutation-checkpoint-verifier.test.ts` inverting forward-line above-test attribution turns the AC2 regression RED. If the diagnostic branch ships: mutation checkpoint inverting distinct diagnostic emission turns the AC2 regression RED.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v1/docs/spec-guidance.md` § Mutation-checkpoint criteria — directive placement (inside the test body).
- `v2/docs/operator-runbook.md` § Gate trust — branch at plan time: tolerance → inside-the-test-body authoring preference only; diagnostic → hollow-on-directive-above-test failure mode and hand-fix (move the directive inside the test body).
- `v2/docs/v1-behaviors.md` — branch at plan time: record forward-line attribution (tolerance) or distinct above-test diagnostic (diagnostic).

## Prerequisites

- `enclosingPinTitle` scans backward from the directive line for the nearest enclosing `test`/`it` title and sets `directive.pinTitle` (`v2/src/execution/mutation-checkpoint-verifier.ts`).
- `linkDirectivesToCriterion` links a `// @mutate` directive to a criterion only when the criterion text contains the directive's pin title (no all-directives-in-file fallback).
