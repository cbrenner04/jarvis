# 00 - Uncommitted-ticks finish path continues when index items remain

When the harness commits uncommitted ticks for a completed subspec and calls
`tryFinishSpecIfDone`, a multi-subspec index with remaining unchecked linked
subspecs causes `tryFinishSpecIfDone` to return `null`. The caller at
`iteration.ts:657` currently coalesces `null` to `0` via `?? 0`, exiting the
run with `criteria-complete` — no agent runs for the next subspec.

Fix: when `tryFinishSpecIfDone` returns `null` at this specific call site, loop
back (return `{ kind: "continue" }`) instead of `?? 0`.

## Decisions

- When `tryFinishSpecIfDone` returns `null` after an uncommitted-ticks commit, loop back for the next subspec — rules out treating `null` as spec-complete exit `0`.
- Keep `?? 0` on call sites where `countUnchecked === 0` was just observed (`before === 0` at line ~473, `after === 0` at line ~1577) — rules out widening the nullish coalesce to other finish paths.
- Do not change `mapExitCodeToReason(0)` in this slice — rules out conflating exit-code labeling with the continuation bug.

## Tasks

- [ ] Change call site `iteration.ts:657` to check `done === null` and return `{ kind: "continue" }` instead of coalescing via `?? 0`.
- [ ] Add regression test: multi-subspec index, uncommitted ticks on subspec 00 only — verify commit of 00, no exit `0`, agent targets subspec 01.
- [ ] Add runbook entry in `v1/docs/operator-runbook.md` noting that a `criteria-complete` summary with `iterations: 0` on a multi-subspec index may mean this bug (rerun; triage index unchecked count) until fixed.
- [ ] Add behavior entry in `v2/docs/v1-behaviors.md`: uncommitted-ticks finish path continues when index tasks remain.
- [ ] Run `bun run typecheck` and relevant tests (`run.test.ts`).

## Acceptance criteria

- [ ] Uncommitted-ticks completion commit on a multi-subspec index where more subspecs remain does **not** exit `0`; the harness loops back (continue) for the next subspec.
- [ ] The two `?? 0` sites preceded by explicit `countUnchecked === 0` observation (`before === 0` at line ~473, `after === 0` at line ~1577) are unchanged.
- [ ] Regression test covers multi-subspec index, uncommitted ticks on subspec 00, verifies commit + no exit 0 + next subspec targeted.
- [ ] `v1/docs/operator-runbook.md` notes that a `criteria-complete` summary with `iterations: 0` on a multi-subspec index may mean this bug (rerun; triage index unchecked count) until fixed.
- [ ] `v2/docs/v1-behaviors.md` records uncommitted-ticks finish path continues when index tasks remain.

## Documentation updates

- `v1/docs/operator-runbook.md` — add runbook entry under `## Known gotchas` (or appropriate section) noting the `iterations: 0` symptom.
- `v2/docs/v1-behaviors.md` — add behavior entry for uncommitted-ticks finish path continuation under `### Patch-mode run workflow`.
