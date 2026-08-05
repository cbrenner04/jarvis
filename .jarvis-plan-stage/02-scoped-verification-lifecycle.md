# Scoped verification lifecycle

## Problem

- Scoped verification has no abort or timeout wiring and can outlive the write iteration that started it.
- Restoration depends on the per-directive `finally` path; abort mid-run can leave mutations applied.
- A scoped run that throws still restores via `finally`, but abort and timeout paths are unbounded.

## Decisions

- Wire scoped verification to the run `AbortSignal` passed from the write step — rules out verification outliving cooperative cancellation.
- Apply a per-directive timeout of `min(remaining write-iteration wall, SUPPORTED_HEALTHY_FILE_BUDGET_MS)` (180s) — rules out indefinite hangs; no separate operator override.
- Snapshot each target file's bytes before the first mutation and restore from that snapshot on abort, timeout, or throw — rules out relying solely on per-directive `finally` when the loop exits abnormally.
- Keep completion-boundary stranded-mutation refusal out of scope — rules out bundling pre-commit checks here.

## Tasks

- Thread `AbortSignal` and remaining iteration budget from `write.ts` / `runWriteStep` into `verifyMutationCheckpoints`.
- Arm per-directive scoped runs with the computed timeout; terminate and restore on expiry.
- Add pre-mutation snapshots and restore on abort, timeout, and throw.
- Add regressions that abort during verification, exceed timeout, and throw mid-directive with distinct assertions from one another.
- Update operator gate-trust text for abort/timeout behavior.
- Run `bun run typecheck` and `bun run test:v2`.

## Acceptance criteria

- [ ] `mutation-checkpoint-verifier.test.ts` — `abort during verification restores pre-mutation bytes` aborts mid-scoped-run via `AbortSignal`, asserts every mutated file matches its pre-mutation bytes, and fails against the pre-fix verifier.
- [ ] `mutation-checkpoint-verifier.test.ts` — `scoped verification timeout terminates and restores` proves a scoped run exceeding its per-directive budget is terminated and the target file is restored rather than blocking indefinitely; it fails against the pre-fix verifier.
- [ ] `mutation-checkpoint-verifier.test.ts` — `throw mid-directive restores from snapshot` proves a scoped runner throw restores the target file via the snapshot path with assertions distinct from the abort regression; it fails against snapshot-less abort-only wiring.
- [ ] `v2/docs/operator-runbook.md` § Gate trust documents scoped verification abort/timeout wiring and snapshot restore on abnormal settle.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Gate trust — scoped verification abort, timeout, and snapshot restore.
