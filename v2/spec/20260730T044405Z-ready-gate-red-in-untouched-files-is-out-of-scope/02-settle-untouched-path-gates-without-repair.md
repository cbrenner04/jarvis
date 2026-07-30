# Settle untouched-path gates without repair

## Problem

Once a terminal gate failure is classified outside the touched set, bounded repair must stop rather
than act on unrelated paths.

## Decision ledger

- `ready_gate_out_of_scope` is a failed, resumable finalization outcome. It bypasses
  `ready_gate_repair` and does not consume an implementation iteration.
- An in-scope or mixed terminal failure keeps today's `ready_gate_failed` bounded-repair behavior.
- Reclassify every gate attempt independently. If a repair follows an in-scope/mixed failure and the
  next gate is fully attributed outside the allowed set, stop further repair and settle out of scope.
- Deadline-killed gates retain the existing timeout skip path; flip, mutation, smoke, publication,
  and ordinary `ready_gate_failed` behavior remain unchanged.

## Task checklist

- Thread the classification through write-loop settlement and repair bypass.
- Preserve repair behavior for in-scope/mixed failures and existing non-classified paths.

## Acceptance criteria

- [ ] `v2/src/execution/write-loop.test.ts` adds pre-fix-failing coverage that a fully attributed
      untouched-path red gate settles `ready_gate_out_of_scope` with no `ready_gate_repair` event and
      unchanged `iterationsConsumed`, while one in-scope failing path enters bounded repair.
- [ ] The same test proves a mixed/in-scope first gate can repair once, then a fully attributed
      untouched-path next gate stops further repair and settles `ready_gate_out_of_scope`.
- [ ] Inverting repair bypass or per-attempt reclassification turns its corresponding test RED;
      negative cases prove out-of-scope gates never invoke repair.
- [ ] `write-loop.test.ts` deadline-kill and bounded-repair tests and
      `workflow-runner.test.ts` "caps ready gate repairs and settles as ready_gate_failed when exhausted"
      stay green.

## Documentation updates

- None; the observable settlement and operator contract is documented by adjacent subspecs.
