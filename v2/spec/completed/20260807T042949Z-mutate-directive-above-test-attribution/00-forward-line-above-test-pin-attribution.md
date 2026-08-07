# Forward-line above-test pin attribution

## Problem

Agents sometimes place `// @mutate` one line above the `test("…", …)` declaration instead of inside the test body. `enclosingPinTitle` scans backward from the directive line for the nearest `test`/`it` title, so a directive above its intended test resolves to the previous test (or none). `linkDirectivesToCriterion` then cannot link it → hollow checkpoint → `contract_miss` even when the directive target text and criterion naming are correct. Evidence: 2026-08-06 `pipeline-plan-stage-consumes-ready-intent` implement (#2667). Distinct from `mutation-checkpoint-criterion-must-name-enclosing-test` (#2655): that is criterion naming the enclosing test; this is directive placement.

## Decision ledger

- Tolerance branch: `enclosingPinTitle` attributes a directive whose **next physical line** is a `test(...)`/`it(...)` declaration to that test's title — rules out a distinct "directive above its test" diagnostic and hollow-on-above-test failure mode.
- A blank line, comment, or multiline `test(` where the title is not on the immediately following line falls back to backward scan (same wrong-pin/hollow behavior as today) — rules out unconditional "one line above" tolerance.
- Forward-line check runs before the backward scan — rules out backward-only attribution when the directive sits on the line immediately above its test declaration.
- Inside-the-test-body placement is authoring guidance in `v1/docs/spec-guidance.md` § Mutation-checkpoint criteria and `DEFAULT_WRITE_STEP_RULES`; both surfaces state adjacent-line above-test tolerance explicitly — rules out write-step preference-only while spec-guidance carries tolerance detail alone.
- `v2/docs/operator-runbook.md` § Gate trust documents inside-the-test-body as authoring preference only (no hollow-on-directive-above-test bullet) — rules out the diagnostic-branch operator triage.
- `v2/docs/v1-behaviors.md` records forward-line above-test pin attribution with the adjacent-line-only bound — rules out silent behavior drift on the parity baseline.
- Reconcile all `v2/spec/implement-queue.md` references to slug `mutate-directive-placed-above-test-goes-hollow` when shipped — rules out stale queue routing for consumed plan work (queue metadata only; no `seeds/` file deletion).
- Out of scope: criterion-naming rule (shipped #2655); distinct above-test diagnostic.

## Prerequisites

- `enclosingPinTitle` scans backward from the directive line for the nearest enclosing `test`/`it` title and sets `directive.pinTitle` (`v2/src/execution/mutation-checkpoint-verifier.ts`).
- `linkDirectivesToCriterion` links a `// @mutate` directive to a criterion only when the criterion text contains the directive's pin title (no all-directives-in-file fallback).

## Tasks

- Extend `enclosingPinTitle` in `v2/src/execution/mutation-checkpoint-verifier.ts`: when the next physical line (`lines[lineIndex + 1]`) matches `PIN_TITLE_PATTERN`, return that test's title before the backward scan; otherwise keep the existing backward scan.
- Add `mutation-checkpoint-verifier.test.ts` regression: a `// @mutate` directive one line above `test("target pin", …)` (with a prior test in the file) gets `pinTitle` `"target pin"` and links through `verifyMutationCheckpoints` to `caught` (not `hollow`).
- Add a bullet to `v1/docs/spec-guidance.md` § Mutation-checkpoint criteria: place `// @mutate` inside the enclosing test body (below the `test("…", …) => {` line); a directive on the line immediately above the `test`/`it` declaration (next physical line, no blank line or intervening comment) is verifier-tolerated but inside-the-body is preferred.
- Extend `DEFAULT_WRITE_STEP_RULES` in `shared/prompts/step-rules.ts` with the same inside-the-test-body placement preference and adjacent-line above-test tolerance bound.
- Extend `test/spec-guidance-doc-assertions.test.ts` to assert § Mutation-checkpoint criteria documents inside-the-test-body placement and adjacent-line above-test tolerance (not unconditional one-line-above).
- Add a source-attributable assertion on `DEFAULT_WRITE_STEP_RULES` (e.g. `shared/prompts/step-rules.test.ts` or an isolated `STEP_RULES` pin in `write.test.ts`) for inside-body preference and adjacent-line tolerance.
- Add a Gate trust note to `v2/docs/operator-runbook.md`: prefer `// @mutate` inside the test body; a directive on the line immediately above the `test`/`it` declaration (next physical line) is tolerated (forward-line attribution) — not a hollow failure mode; blank line or intervening comment falls back to backward scan.
- Record forward-line above-test pin attribution (adjacent-line-only) in `v2/docs/v1-behaviors.md`.
- Remove or reconcile every `v2/spec/implement-queue.md` reference to slug `mutate-directive-placed-above-test-goes-hollow` (Start here next, open-seeds table, and any duplicate mentions).
- Run `bun run typecheck`, `bun run test:v2`, and `bun run test:shared`; if `DEFAULT_WRITE_STEP_RULES` bytes change, refresh v1 rendered snapshot fixtures and run `bun run test:v1`.

## Acceptance criteria

- [x] `v1/docs/spec-guidance.md` § Mutation-checkpoint criteria instructs authors to place `// @mutate` inside the enclosing test body (below the `test("…", …) => {` line); states that a directive on the line immediately above the `test`/`it` declaration (next physical line, no blank line or intervening comment) is verifier-tolerated but inside-the-body is preferred.
- [x] `test/spec-guidance-doc-assertions.test.ts` asserts § Mutation-checkpoint criteria documents inside-the-test-body placement and adjacent-line above-test tolerance; fails when that guidance is removed.
- [x] `DEFAULT_WRITE_STEP_RULES` carries inside-the-test-body placement preference and adjacent-line above-test tolerance; a source-attributable test (not wholesale `toContain(DEFAULT_WRITE_STEP_RULES)`) fails when that prose is removed.
- [x] `mutation-checkpoint-verifier.test.ts` — `directive immediately above test declaration links to that pin title` proves a `// @mutate` one line above `test("target pin", …)` (with a prior test in the file) gets `pinTitle` `"target pin"` and reaches `caught` via `verifyMutationCheckpoints`; it fails against backward-only `enclosingPinTitle`.
- [x] `mutation-checkpoint-verifier.test.ts` — `directive immediately above test declaration links to that pin title`; Mutation checkpoint: its pinning test carries `// @mutate v2/src/execution/mutation-checkpoint-verifier.ts` `"PIN_TITLE_PATTERN.exec(lines[lineIndex + 1] ?? \"\")" -> "undefined"` inverting the forward-line check in `enclosingPinTitle`; the mutation turns the named pin RED.
- [x] `v2/docs/operator-runbook.md` § Gate trust documents inside-the-test-body as authoring preference; adjacent-line above-test tolerance (next physical line is the `test`/`it` declaration) and that blank line or intervening comment falls back to backward scan — distinct from the criterion-omits-pin-title hollow bullet.
- [x] `v2/docs/v1-behaviors.md` records forward-line above-test pin attribution with the adjacent-line-only bound.
- [x] `v2/spec/implement-queue.md` has no remaining references to slug `mutate-directive-placed-above-test-goes-hollow` (Start here next, open-seeds table, and any duplicate mentions); wording does not imply deleting a `seeds/` file.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:shared` pass; if `DEFAULT_WRITE_STEP_RULES` bytes changed, `bun run test:v1` passes after v1 rendered snapshot refresh.

## Documentation updates

- `v1/docs/spec-guidance.md` § Mutation-checkpoint criteria — directive placement (inside the test body; adjacent-line above-test tolerated).
- `shared/prompts/step-rules.ts` / `DEFAULT_WRITE_STEP_RULES` — same placement preference and adjacent-line tolerance for implement and other write steps.
- `v2/docs/operator-runbook.md` § Gate trust — inside-the-test-body authoring preference; adjacent-line above-test tolerance.
- `v2/docs/v1-behaviors.md` — forward-line above-test pin attribution (adjacent-line-only).
- `v2/spec/implement-queue.md` — reconcile slug `mutate-directive-placed-above-test-goes-hollow`.
