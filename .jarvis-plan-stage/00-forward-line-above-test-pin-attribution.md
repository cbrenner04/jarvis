# Forward-line above-test pin attribution

## Problem

Agents sometimes place `// @mutate` one line above the `test("…", …)` declaration instead of inside the test body. `enclosingPinTitle` scans backward from the directive line for the nearest `test`/`it` title, so a directive above its intended test resolves to the previous test (or none). `linkDirectivesToCriterion` then cannot link it → hollow checkpoint → `contract_miss` even when the directive target text and criterion naming are correct. Evidence: 2026-08-06 `pipeline-plan-stage-consumes-ready-intent` implement (#2667). Distinct from `mutation-checkpoint-criterion-must-name-enclosing-test` (#2655): that is criterion naming the enclosing test; this is directive placement.

## Decision ledger

- Tolerance branch: `enclosingPinTitle` attributes a directive whose immediately-following line is a `test(...)`/`it(...)` declaration to that test's title — rules out a distinct "directive above its test" diagnostic and hollow-on-above-test failure mode.
- Forward-line check runs before the backward scan — rules out backward-only attribution when the directive sits one line above its test.
- Inside-the-test-body placement is authoring guidance in `v1/docs/spec-guidance.md` § Mutation-checkpoint criteria and `DEFAULT_WRITE_STEP_RULES` (preference, not a verifier failure mode) — rules out omitting placement guidance while tolerating above-test placement.
- `v2/docs/operator-runbook.md` § Gate trust documents inside-the-test-body as authoring preference only (no hollow-on-directive-above-test bullet) — rules out the diagnostic-branch operator triage.
- `v2/docs/v1-behaviors.md` records forward-line above-test attribution — rules out silent behavior drift on the parity baseline.
- Close `v2/spec/implement-queue.md` row #2 (`seeds/mutate-directive-placed-above-test-goes-hollow`) when shipped — rules out a stale queue item for consumed work.
- Out of scope: criterion-naming rule (shipped #2655); distinct above-test diagnostic.

## Prerequisites

- `enclosingPinTitle` scans backward from the directive line for the nearest enclosing `test`/`it` title and sets `directive.pinTitle` (`v2/src/execution/mutation-checkpoint-verifier.ts`).
- `linkDirectivesToCriterion` links a `// @mutate` directive to a criterion only when the criterion text contains the directive's pin title (no all-directives-in-file fallback).

## Tasks

- Extend `enclosingPinTitle` in `v2/src/execution/mutation-checkpoint-verifier.ts`: when the line immediately after the directive matches `PIN_TITLE_PATTERN`, return that test's title; otherwise keep the existing backward scan.
- Add `mutation-checkpoint-verifier.test.ts` regression: a `// @mutate` directive one line above `test("target pin", …)` (with a prior test in the file) gets `pinTitle` `"target pin"` and links through `verifyMutationCheckpoints` to `caught` (not `hollow`).
- Add a bullet to `v1/docs/spec-guidance.md` § Mutation-checkpoint criteria: place `// @mutate` inside the enclosing test body (below the `test("…", …) => {` line); a directive immediately above the `test` line is tolerated but inside-the-body is preferred.
- Extend `DEFAULT_WRITE_STEP_RULES` in `shared/prompts/step-rules.ts` with the same inside-the-test-body placement preference.
- Extend `test/spec-guidance-doc-assertions.test.ts` to assert § Mutation-checkpoint criteria documents inside-the-test-body placement (and that above-test is tolerated).
- Add a source-attributable assertion on `DEFAULT_WRITE_STEP_RULES` (e.g. `shared/prompts/step-rules.test.ts` or an isolated `STEP_RULES` pin in `write.test.ts`) for the same placement contract.
- Add a Gate trust note to `v2/docs/operator-runbook.md`: prefer `// @mutate` inside the test body; a directive one line above the `test` declaration is tolerated (forward-line attribution) — not a hollow failure mode.
- Record forward-line above-test attribution in `v2/docs/v1-behaviors.md`.
- Remove or close `v2/spec/implement-queue.md` row #2 (`seeds/mutate-directive-placed-above-test-goes-hollow`).
- Run `bun run typecheck` and `bun run test:v2`; if `DEFAULT_WRITE_STEP_RULES` bytes change, refresh v1 rendered snapshot fixtures and run `bun run test:v1`.

## Acceptance criteria

- [ ] `v1/docs/spec-guidance.md` § Mutation-checkpoint criteria instructs authors to place `// @mutate` inside the enclosing test body (below the `test("…", …) => {` line); states that a directive immediately above the `test` declaration is tolerated but inside-the-body is preferred.
- [ ] `test/spec-guidance-doc-assertions.test.ts` asserts § Mutation-checkpoint criteria documents inside-the-test-body placement and above-test tolerance; fails when that guidance is removed.
- [ ] `DEFAULT_WRITE_STEP_RULES` carries the same inside-the-test-body placement preference; a source-attributable test (not wholesale `toContain(DEFAULT_WRITE_STEP_RULES)`) fails when that prose is removed.
- [ ] `mutation-checkpoint-verifier.test.ts` — `directive immediately above test declaration links to that pin title` proves a `// @mutate` one line above `test("target pin", …)` (with a prior test in the file) gets `pinTitle` `"target pin"` and reaches `caught` via `verifyMutationCheckpoints`; it fails against backward-only `enclosingPinTitle`.
- [ ] `mutation-checkpoint-verifier.test.ts` — `directive immediately above test declaration links to that pin title`; Mutation checkpoint: its pinning test carries `// @mutate v2/src/execution/mutation-checkpoint-verifier.ts` inverting the immediately-following-line forward attribution in `enclosingPinTitle`; the mutation turns the named pin RED.
- [ ] `v2/docs/operator-runbook.md` § Gate trust documents inside-the-test-body as authoring preference; a directive one line above the `test` declaration is tolerated (forward-line attribution), distinct from the criterion-omits-pin-title hollow bullet.
- [ ] `v2/docs/v1-behaviors.md` records forward-line above-test pin attribution.
- [ ] `v2/spec/implement-queue.md` no longer lists row #2 (`seeds/mutate-directive-placed-above-test-goes-hollow`).
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v1/docs/spec-guidance.md` § Mutation-checkpoint criteria — directive placement (inside the test body; above-test tolerated).
- `shared/prompts/step-rules.ts` / `DEFAULT_WRITE_STEP_RULES` — same placement preference for implement and other write steps.
- `v2/docs/operator-runbook.md` § Gate trust — inside-the-test-body authoring preference; forward-line above-test tolerance.
- `v2/docs/v1-behaviors.md` — forward-line above-test pin attribution.
- `v2/spec/implement-queue.md` — close row #2 (`seeds/mutate-directive-placed-above-test-goes-hollow`).
