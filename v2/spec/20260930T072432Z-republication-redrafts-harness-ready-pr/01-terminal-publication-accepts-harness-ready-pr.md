# Terminal publication accepts a harness-ready PR

## Problem

`resolveReadyFlipTarget` (`v2/src/execution/terminal-publication.ts`) maps `OpenPrNotDraftError` to a `gh pr ready` terminal failure, even when the harness itself already flipped that PR ready.

## Decisions

- On a sole open non-draft PR, consult the lineage-evidence seam from subspec 00 keyed on `(branch, input.baseRef, prNumber)`; a match treats the flip as already satisfied: skip `gh pr ready`, re-record evidence for that PR, succeed — rules out a pointless undo+reflip and rules out refusing the harness's own flip.
- No evidence, a different PR number, or a branch/base mismatch keeps the existing `gh pr ready` terminal failure — rules out accepting human-flipped PRs.
- Production binds the seam from the pipeline entry run row (`pipeline-execution.ts`, beside `recordHarnessReadyFlipEvidence`) — rules out an unwired default.

## Acceptance criteria

- [x] A `terminal-publication` test with a fake `gh` reporting one open non-draft #N and matching lineage evidence asserts no `gh pr ready` call, a fresh evidence record for #N, and success; fails against pre-fix code.
- [x] The same fake without evidence (human-flipped) fails with `operation: "gh pr ready"` and records no evidence.
- [x] Evidence for #M, or for a different branch/base than the target, still fails as above.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — drop manual `gh pr ready --undo` recovery for harness-flipped PRs on terminal publication; keep it for human-flipped PRs.
- `v2/docs/write-behavior.md` — terminal publication accepts an evidenced already-ready PR.
