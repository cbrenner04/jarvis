# Scoped verification lifecycle

## Problem

- Scoped verification has no abort or timeout wiring and can outlive the write iteration that started it.
- Restoration depends on the per-directive `finally` path; abort mid-run can leave mutations applied.
- A scoped run that throws still restores via `finally`, but abort and timeout paths are unbounded.

## Decisions

- Wire scoped verification to the run `AbortSignal` passed from the write step — rules out verification outliving cooperative cancellation.
- Apply a per-directive timeout of `min(remaining write-iteration wall, SUPPORTED_HEALTHY_FILE_BUDGET_MS)` (180s) — rules out indefinite hangs; no separate operator override.
- On abort or timeout expiry, terminate the active scoped `bun` subprocess (abort the `AbortSignal` passed to `realAsyncSubprocessRunner`, then kill the child if still running) before restoring — rules out "stop awaiting" without process termination.
- Snapshot each target file's bytes before the first mutation and restore from that snapshot on abort, timeout, or throw — rules out relying solely on per-directive `finally` when the loop exits abnormally.
- Keep completion-boundary stranded-mutation refusal out of scope — rules out bundling pre-commit checks here.
- `v2/docs/v1-behaviors.md` reconciliation lands in subspec 03 — rules out catalog drift in this slice.

## Tasks

- Thread `AbortSignal` and remaining iteration budget from `write.ts` / `runWriteStep` into `verifyMutationCheckpoints`.
- Arm per-directive scoped runs with the computed timeout; on expiry, kill the subprocess and restore from snapshot.
- Add pre-mutation snapshots and restore on abort, timeout, and throw.
- Add regressions that abort during verification, exceed timeout, and throw mid-directive with distinct assertions from one another.
- Update operator gate-trust text for abort/timeout behavior.
- Run `bun run typecheck` and `bun run test:v2`.

## Acceptance criteria

- [ ] `mutation-checkpoint-verifier.test.ts` — `abort during verification restores pre-mutation bytes` aborts mid-scoped-run via `AbortSignal`, asserts the scoped `bun` subprocess is terminated and every mutated file matches its pre-mutation bytes; it fails against the pre-fix verifier.
- [ ] `mutation-checkpoint-verifier.test.ts` — `scoped verification timeout terminates and restores` proves a scoped run exceeding its per-directive budget kills the subprocess and restores the target file rather than blocking indefinitely; it fails against the pre-fix verifier.
- [ ] `mutation-checkpoint-verifier.test.ts` — `throw mid-directive restores from snapshot` proves a scoped runner throw restores the target file via the snapshot path with assertions distinct from the abort regression; it fails against snapshot-less abort-only wiring.
- [ ] `mutation-checkpoint-verifier.test.ts` — `abort during verification restores pre-mutation bytes`; Mutation checkpoint: its regression carries `// @mutate v2/src/execution/mutation-checkpoint-verifier.ts "<snapshot-restore guard>" -> "<finally-only restore>"` (revert snapshot restore on abort); reverting the real guard turns the named pin red.
- [ ] `v2/docs/operator-runbook.md` § Gate trust documents scoped verification abort/timeout subprocess termination and snapshot restore on abnormal settle.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Gate trust — scoped verification abort, timeout, subprocess kill, and snapshot restore (`v2/docs/v1-behaviors.md` reconciled in subspec 03).
