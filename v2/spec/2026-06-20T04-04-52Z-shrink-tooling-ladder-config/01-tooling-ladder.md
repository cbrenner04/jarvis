# Tooling pre-pass ladder and no-change test skip

Differentiate the `tooling`, `agent`, and `both` values of `modes.patch.shrink`
(from `00`) inside `runPatchShrinkPhase`: a deterministic `check:fix` pre-pass,
a conditional agent invocation, and a contract-test re-run skipped when shrink
produced no file changes.

## Problem

Shrink always invokes an agent after completion even when a deterministic
formatter would simplify the diff with zero tokens, and even when there is
nothing to simplify. The existing agent path already short-circuits on an empty
worktree before the contract `bun run test`, but there is no deterministic
pre-pass and no path-selection by config value.

## Decisions

- `tooling` and `both` run a deterministic pre-pass: `check:fix` restricted to the implementation allowlist; out-of-allowlist edits reverted by the existing scope guard. Rules out running repo-wide `check:fix` and committing churn outside shrink scope.
- Pre-pass diff-stat gate: a no-op (`git diff` over the allowlist is empty after `check:fix`) produces no commit and no contract test re-run. Rules out committing or test-gating an empty formatter pass.
- In `both`, the agent is invoked only when the pre-pass was a no-op and the run-scoped diff is non-empty. Rules out unconditional agent shrink after every completion; when `check:fix` already changed files, the cheap pass owns this round and the agent is skipped.
- `agent` skips the pre-pass and invokes the agent on the existing path. Rules out forcing tooling ahead of an operator who selected agent-only.
- Bloat-heuristic gate is just "non-empty run-scoped diff." `Deferred to first consumer: richer structural bloat detection — pin when tuning shows the agent is invoked on diffs with no shrinkable bloat`.
- No file changes from either path skips the `bun run test` contract re-run; changes retain the AC-regression and no-deleted-scoped-test guards unchanged. Rules out always re-running `bun run test` after a no-op shrink.
- The deterministic pre-pass emits no `patch_phase: "shrink"` telemetry row (no agent invoked); only the agent invocation emits one. Rules out fabricating an agent telemetry row for a tokenless pass.

## Task checklist

- [ ] In `runPatchShrinkPhase`, branch on the resolved `modes.patch.shrink` value.
- [ ] Implement the `check:fix`-on-allowlist deterministic pre-pass with diff-stat no-op detection, contract validation (AC regression, no deleted scoped `*.test.ts`, `bun run test`) only when changes exist, and a single `shrink:` commit on success.
- [ ] Gate the agent invocation in `both` on pre-pass no-op + non-empty run-scoped diff; keep `agent` unconditional; keep `tooling` agent-free.
- [ ] Ensure the no-change path (either pre-pass or agent producing no surviving edits) skips `bun run test`.
- [ ] Docs per below.

## Acceptance criteria

- [ ] With `modes.patch.shrink: "tooling"`, a completion whose allowlisted files have a `check:fix`-fixable issue results in those fixes applied and committed as a `shrink:` commit, and no shrink agent is invoked.
- [ ] With `modes.patch.shrink: "tooling"` and a completion `check:fix` leaves unchanged, no `shrink:` commit is made and `bun run test` is not re-run.
- [ ] With `modes.patch.shrink: "agent"`, the deterministic `check:fix` pre-pass does not run and the agent shrink invocation runs as on the pre-existing path.
- [ ] With `modes.patch.shrink: "both"`, when `check:fix` applies fixes the agent is not invoked; when `check:fix` is a no-op and a non-empty run-scoped diff exists the agent is invoked.
- [ ] The deterministic pre-pass restricts edits to allowlisted files: a `check:fix` change to a non-allowlisted file is reverted and not committed.
- [ ] When a shrink path produces no surviving file changes, the contract `bun run test` is not run; when it produces changes, the AC-regression and deleted-scoped-test guards still apply and a contract miss discards all shrink changes without elevating the run exit code.
- [ ] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- `v1/docs/run-loop.md`: document the shrink ladder — `tooling` pre-pass (`check:fix` on allowlist + diff-stat gate), conditional agent gating in `both`, `agent`-only path, and the no-change test-skip.
- `v2/docs/v1-behaviors.md`: update the post-completion shrink section with the per-value ladder behavior and the contract-test skip on no file changes.
