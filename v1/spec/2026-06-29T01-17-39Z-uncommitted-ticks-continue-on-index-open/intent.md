---
name: uncommitted-ticks-continue-on-index-open
---
# Uncommitted-ticks finish path must continue when index items remain

After operator ticks a subspec's AC, patch mode's uncommitted-ticks path commits it, then calls `tryFinishSpecIfDone`. When the index still has unchecked linked subspecs, that returns `null`, which `?? 0` coalesces to exit `0` (`criteria-complete`) — no agent runs for the next subspec. Fix: when `tryFinishSpecIfDone` returns `null` here, loop back (return `{ kind: "continue" }`) instead of `?? 0`.

## Decisions

- When `tryFinishSpecIfDone` returns `null` after an uncommitted-ticks commit, loop back for the next subspec — rules out treating `null` as spec-complete exit `0`.
- Keep `?? 0` on call sites where `countUnchecked === 0` was just observed (`before === 0` / `after === 0` agent paths); rules out widening the nullish coalesce to other finish paths.
- Regression test: multi-subspec index, uncommitted ticks on subspec 00 only — expect commit of 00, **no** exit `0`, agent (or next harness pass) targets subspec 01; rules out single-subspec-only coverage in `run.test.ts`.
- Do not change `mapExitCodeToReason(0)` in this slice; rules out conflating exit-code labeling with the continuation bug.

## Acceptance criteria

- [ ] Uncommitted-ticks completion commit on a multi-subspec index where more subspecs remain does **not** exit `0`; the harness loops back (continue) for the next subspec.
- [ ] The two `?? 0` sites preceded by explicit `countUnchecked === 0` observation (`before === 0` at line ~473, `after === 0` at line ~1577) are unchanged.
- [ ] Regression test covers multi-subspec index, uncommitted ticks on subspec 00, verifies commit + no exit 0 + next subspec targeted.
- [ ] `v1/docs/operator-runbook.md` — note that a `criteria-complete` summary with `iterations: 0` on a multi-subspec index may mean this bug (rerun; triage index unchecked count) until fixed.
- [ ] `v2/docs/v1-behaviors.md` — uncommitted-ticks finish path continues when index tasks remain.
