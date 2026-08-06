# Daemon

`ready_gate_out_of_scope` rows whose outside paths are unchanged still advertise `resumable: true` and admit `jarvis run resume`, producing infinite identical resume loops over a condition no resume can change.

## Decision ledger

- An out-of-scope settlement whose outside paths are unchanged reports `loop_finished.resumable: false` — rules out infinite identical resume loops.
- `composeRunOperatorError` for that settlement uses `nextAction` other than `resume` — rules out CLI mirrors that still guide resume.
- `jarvis run resume` admission rejects naming the unchanged outside paths rather than re-settling `ready_gate_out_of_scope` with `resumable: true` — rules out resume as a no-op retry path.
- In-scope and mixed gate failures keep existing `ready_gate_failed` resumability; only unchanged-path `ready_gate_out_of_scope` changes.

## Task checklist

- Thread non-resumable settlement through write-loop `loop_finished` projection and `composeRunOperatorError`.
- Update ready-gate out-of-scope resume admission in workflow-runner / daemon resume handlers.
- Update `write-loop.test.ts` untouched-path settlement tests and `daemon-resume.test.ts` "repeated untouched red on an ordinary write row settles ready_gate_out_of_scope with preserved outside-path detail".

## Acceptance criteria

- [ ] `daemon-resume.test.ts` "repeated untouched red on an ordinary write row settles ready_gate_out_of_scope with preserved outside-path detail" is updated to assert resume admission rejects naming the unchanged outside paths rather than re-settling with `resumable: true`; it fails against the pre-fix code.

## Documentation updates

- `v2/docs/operator-runbook.md` § Gate trust — out of scope means the failure also reproduces on base (fails on base too) and is not fixed by resume; update resume guidance for unchanged-path `ready_gate_out_of_scope`.
