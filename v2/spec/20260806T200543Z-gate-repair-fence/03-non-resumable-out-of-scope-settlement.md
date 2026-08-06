# Non-resumable out-of-scope settlement

`ready_gate_out_of_scope` rows whose outside paths are unchanged still advertise `resumable: true` and admit `jarvis run resume`, producing infinite identical resume loops over a condition no resume can change.

## Decision ledger

- This spec narrows only unchanged-path `ready_gate_out_of_scope`; broader "unless a resume could plausibly change the outcome" plausibility is out of scope here — rules out silent expansion to other terminal reasons.
- An out-of-scope settlement whose `readyGateOutsidePaths` are unchanged reports `loop_finished.resumable: false` — rules out infinite identical resume loops.
- `composeRunOperatorError` for that settlement uses `nextAction: "stop"` and `retryable: false` — rules out CLI mirrors that still guide resume.
- Unchanged outside paths means set equality of `readyGateOutsidePaths` against the first `ready_gate_out_of_scope` settlement on the same durable row; worktree edits that do not change that attributable path set still count as unchanged — rules out resume when only unrelated files moved.
- `jarvis run resume` admission rejects naming the unchanged outside paths rather than re-settling `ready_gate_out_of_scope` with `resumable: true` — rules out resume as a no-op retry path.
- Ordinary write rows and review/publication-tail rows share the same unchanged-path admission rejection — rules out divergent review-tail resume semantics.
- In-scope and mixed gate failures keep existing `ready_gate_failed` resumability; only unchanged-path `ready_gate_out_of_scope` changes.
- Supersedes `v2/spec/completed/20260730T044405Z-ready-gate-red-in-untouched-files-is-out-of-scope/04-resume-out-of-scope-gate-finalization.md` for unchanged-path settlements: that spec admitted `ready_gate_out_of_scope` for finalization retry with `resumable: true`; this work makes unchanged-path out-of-scope non-resumable and rejects resume admission. Touch points: `run-operator-error.ts` `nextAction` and remediation strings, resume admission sets in workflow-runner / daemon resume handlers, `daemon-host.md` resumability table.

## Task checklist

- Thread non-resumable settlement through write-loop `loop_finished` projection and `composeRunOperatorError`.
- Update ready-gate out-of-scope resume admission in workflow-runner / daemon resume handlers for ordinary write and review/publication-tail rows.
- Update `write-loop.test.ts` untouched-path settlement tests, `daemon-resume.test.ts` "repeated untouched red on an ordinary write row settles ready_gate_out_of_scope with preserved outside-path detail" and "repeated untouched red on a review row settles ready_gate_out_of_scope with preserved outside-path detail", and `workflow-runner.test.ts` "settles an attributed untouched red gate as ready_gate_out_of_scope without repair" and "persists ready_gate_out_of_scope evidence through durable logs and operator mirrors".

## Acceptance criteria

- [x] `v2/src/execution/write-loop.test.ts` adds a pre-fix-failing regression that an out-of-scope settlement whose outside paths are unchanged reports `loop_finished.resumable: false` and `composeRunOperatorError` `nextAction: "stop"` with `retryable: false`.
- [x] `write-loop.test.ts` "never invokes repair for a fully attributed untouched-path gate" stays green.
- [x] `daemon-resume.test.ts` "repeated untouched red on an ordinary write row settles ready_gate_out_of_scope with preserved outside-path detail" is updated to assert resume admission rejects naming the unchanged outside paths rather than re-settling with `resumable: true`; it fails against the pre-fix code.
- [x] `daemon-resume.test.ts` "repeated untouched red on a review row settles ready_gate_out_of_scope with preserved outside-path detail" is updated to assert the same admission rejection; it fails against the pre-fix code.
- [x] `workflow-runner.test.ts` "settles an attributed untouched red gate as ready_gate_out_of_scope without repair" and "persists ready_gate_out_of_scope evidence through durable logs and operator mirrors" are updated to expect `resumable: false` and `nextAction: "stop"` for unchanged-path settlement; they fail against the pre-fix code.

## Documentation updates

- `v2/docs/operator-runbook.md` § Gate trust — out of scope means the failure also reproduces on base (fails on base too) and is not fixed by resume; update resume guidance for unchanged-path `ready_gate_out_of_scope`.
- `v2/docs/daemon-host.md` — `ready_gate_out_of_scope` resumability row reflects unchanged-path non-resumable settlement.
- `v2/docs/v1-behaviors.md` — record v2 unchanged-path `ready_gate_out_of_scope` is terminal non-resumable with `nextAction: stop`.
