# A structurally invalid staged tree refuses before any stage mutation

## Problem

On the blocked-write path, `admitPlanRecoveryBlockerAndClaim` (`v2/src/execution/workflow-runner-resume.ts`) rewrites staged `intent.md` to strip a provenance-proven harness blocker, and only afterwards does `recoverPlanStage` run `revalidateStagedPlanContract`. So a tree that refuses `plan_stage_invalid` — missing `index.md`, unreadable subspec — has already had its `intent.md` truncated on disk when the operator gets the refusal back. Reachable on the base today: the strip at the `writeFileSync(intentPath, ...)` site runs unconditionally before the validation call below it.

## Decisions

- Validation moves ahead of the blocker strip rather than the strip being made undoable — an untouched tree is the contract, not a restored one. Rules out snapshot-and-rollback.
- Validation order stays contract-then-lint; only its position relative to the strip changes. Rules out folding lint into admission.
- The lint pass keeps running before the strip too, so a lint refusal also leaves the blocker in place — the operator re-invokes after fixing lint and the harness blocker is still stripped on the successful attempt.

## Acceptance criteria

- [x] A regression test in `v2/src/execution/workflow-runner-resume.test.ts` recovers a blocked-write stage carrying a provenance-proven harness blocker and a structurally invalid tree (its index file absent), asserts the refusal is `plan_stage_invalid`, and asserts the staged intent file still ends with the harness blocker; it fails against the pre-fix code.
- [x] A test asserts a lint-violation refusal likewise leaves the staged intent file byte-identical to its pre-invocation content.
- [x] A test asserts an admitted recovery over a valid tree still strips the proven harness blocker before landing.
- [x] The `operator_blocker` refusal tests in `v2/src/execution/workflow-runner-resume.test.ts` stay green — operator-authored blockers still refuse before validation.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.

## Documentation updates

- [x] `v2/docs/workflow-runner.md` — recovery refuses an invalid staged tree before mutating it; the harness-blocker strip happens only on an admitted, validated tree.
- [x] `v2/docs/v1-behaviors.md` — record the strip-after-validation ordering on the `recoverPlanStage` entry.
