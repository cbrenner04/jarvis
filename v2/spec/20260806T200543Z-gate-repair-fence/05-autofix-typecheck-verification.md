# Autofix typecheck verification

Ready-gate repair autofix can turn a green tree red; every repair entry re-applies the same break because autofix output is not typecheck-verified before commit.

## Decision ledger

- Autofix runs `typecheck` on its own output before the fence commit — rules out committing autofix edits that fail typecheck.
- When typecheck fails, autofix edits are reverted, the discard is logged with the failing output, and the gate proceeds to repair on the pre-autofix tree — rules out a repair step that can only make things worse.
- Discard observability: emit `ready_gate_autofix_discarded` on the run log with `typecheckExitCode` and bounded `typecheckOutput` tail, visible in `jarvis run log` tail — rules out unverifiable "records the discard" prose.
- When autofix output typechecks, the existing fence commit, republish, and re-gate path is unchanged — rules out regressing the green autofix fast path.
- Completes autofix fence validation against the classification-derived attributable allowset from subspec 02 (typecheck runs before `enforceRepairIterationFence` commits autofix output) — rules out inconsistent intermediate autofix fence state.
- Out of scope: the uncommitted-autofix-edits path into `completion_commit_failed` (evidence only, not fixed here).

## Task checklist

- Add post-autofix `typecheck` verification in `publishWithReadyRepair` before `enforceRepairIterationFence` commits autofix output.
- Unify autofix fence validation with the classification-derived attributable allowset in the same seam.
- Revert worktree edits and emit `ready_gate_autofix_discarded` on typecheck failure.
- Add typecheck-failure and happy-path regressions under `write-loop.test.ts` `ready-gate repair autofix`.

## Acceptance criteria

- [x] `v2/src/execution/write-loop.test.ts` adds a pre-fix-failing regression that when autofix produces a tree failing `typecheck`, the gate reverts autofix edits, emits `ready_gate_autofix_discarded` with the failing typecheck output visible in `jarvis run log` tail, and enters repair against the pre-autofix tree instead of committing the broken edits.
- [x] `write-loop.test.ts` adds a pre-fix-failing regression that a run whose autofix output typechecks is unaffected: fence commit, republish, and re-gate match pre-change behavior; it fails against the pre-fix code if verification is missing but autofix would have committed broken output.
- [x] In `v2/src/execution/write-loop.test.ts` `ready-gate repair autofix` describe block, the test titled `autofix output failing typecheck is reverted before the fence commit` carries a `// @mutate` directive inverting the post-autofix typecheck guard; the mutation turns that test RED. (Criterion names the enclosing `test()` title verbatim so `linkDirectivesToCriterion` resolves the directive.)
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Gate trust — autofix is typecheck-verified before commit; describe `ready_gate_autofix_discarded` log shape operators should expect.
