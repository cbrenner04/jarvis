# Autofix typecheck verification

Ready-gate repair autofix can turn a green tree red; every repair entry re-applies the same break because autofix output is not typecheck-verified before commit.

## Decision ledger

- Autofix runs `typecheck` on its own output before the fence commit — rules out committing autofix edits that fail typecheck.
- When typecheck fails, autofix edits are reverted, the discard is logged with the failing output, and the gate proceeds to repair on the pre-autofix tree — rules out a repair step that can only make things worse.
- When autofix output typechecks, the existing fence commit, republish, and re-gate path is unchanged — rules out regressing the green autofix fast path.
- Out of scope: the uncommitted-autofix-edits path into `completion_commit_failed` (evidence only, not fixed here).

## Task checklist

- Add post-autofix `typecheck` verification in `publishWithReadyRepair` before `enforceRepairIterationFence` commits autofix output.
- Revert worktree edits and emit a durable discard log on typecheck failure.
- Add happy-path and typecheck-failure regressions under `write-loop.test.ts` `ready-gate repair autofix`.

## Acceptance criteria

- [ ] `v2/src/execution/write-loop.test.ts` adds a pre-fix-failing regression that when autofix produces a tree failing `typecheck`, the gate reverts autofix edits, records the discard with the failing output, and enters repair against the pre-autofix tree instead of committing the broken edits.
- [ ] `write-loop.test.ts` adds a regression that a run whose autofix output typechecks is unaffected: fence commit, republish, and re-gate match pre-change behavior; it fails against the pre-fix code if verification is missing but autofix would have committed broken output.
- [ ] In `v2/src/execution/write-loop.test.ts` `ready-gate repair autofix` describe block, a `// @mutate` directive inverting the post-autofix typecheck guard turns its pinning test RED.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Gate trust — autofix is typecheck-verified before commit; describe the discard log shape operators should expect.
