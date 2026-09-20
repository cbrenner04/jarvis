# The derivation-failure reason is written to the run log

## Problem

`initializeFrozenRepairAllowset` (`v2/src/execution/write-loop.ts:3546-3564`) turns a derivation failure into `new Error("Ready-gate repair fence could not derive allowed paths")` and `enumerateAutofixChangedPaths` (`:4033-4043`) into a bare `FixCommandError`. Neither appends anything to the run log, so the only operator-visible trace is the `completionCommitError` string on the `run list` row — the named reason from [00-named-derivation-failure-reasons.md](00-named-derivation-failure-reasons.md) would die at the call site.

## Decisions

- A new `ready_gate_fence_derivation_failed` run-log record in `v2/src/persistence/log-stream.ts` carries the named reason and the derivation site (repair-fence initialization or autofix path enumeration); rules out folding the reason into the free-text `message` of an existing record, where it is not queryable.
- The record is appended before settlement at both sites, so it survives even when the settlement shape changes in [02-published-lane-settles-honestly.md](02-published-lane-settles-honestly.md).
- Adding the record needs no change to run-log rendering, the TUI, or `deriveOperatorIncidents`: sibling `ready_gate_*` kinds are referenced only by `log-stream.ts` and `write-loop.ts`, and `jarvis run log` renders records raw.
- The error message carried into settlement names the reason too; rules out a log record and a settlement string that disagree about the cause.

## Acceptance criteria

- [ ] A `write-loop.test.ts` test forces a repair-fence derivation failure and asserts the `ready_gate_fence_derivation_failed` record, with its named reason, is appended to the run log before the run settles. It fails against the pre-fix unlogged bare `Error`.
- [ ] A `write-loop.test.ts` test forces an autofix path-enumeration derivation failure and asserts the same record is appended with that site's identity; it fails against the pre-fix `FixCommandError` path.
- [ ] In both `write-loop.test.ts` tests above, an assertion checks the settled `completionCommitError` contains the named reason equal to the logged record's reason field; it fails against the pre-fix bare message.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — the fence-derivation failure record, its reasons, and the two derivation sites that emit it.
- `v2/docs/v1-behaviors.md` — record the new run-log record for fence-derivation failure.
