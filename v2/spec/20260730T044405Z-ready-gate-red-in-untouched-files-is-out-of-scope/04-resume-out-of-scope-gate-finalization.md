# Resume out-of-scope gate finalization

## Problem

A resumable untouched-path gate failure must retry finalization, not re-enter an agent or repair
loop, in both ordinary and reconstructed workflow tails.

## Decision ledger

- Admit `ready_gate_out_of_scope` only for finalization retry. Resume never starts a repair agent or
  emits `ready_gate_repair` for this reason.
- Ordinary write runs and review/publication-tail reconstruction use the same retry behavior.
- A green retry completes normal finalization. A repeated fully attributed untouched-path red settles
  `ready_gate_out_of_scope` again with its newly preserved detail.

## Task checklist

- Add finalization-only resume admission and reconstruction handling for the new reason.
- Verify green and repeated-red retry outcomes without agent or repair invocation.

## Acceptance criteria

- [ ] `v2/src/daemon/daemon-resume.test.ts` adds pre-fix-failing coverage that
      `ready_gate_out_of_scope` is admitted for finalization retry and refuses repair re-entry;
      inverting admission turns that test RED.
- [ ] Ordinary write-run and review/publication-tail reconstruction regressions prove resume invokes
      neither an agent nor repair, completes normal finalization after a green retry, and settles
      `ready_gate_out_of_scope` again with preserved outside-path detail after repeated untouched red.
- [ ] Inverting finalization-only resume routing or repeated-red evidence preservation turns its
      corresponding regression RED.

## Documentation updates

- None; finalization retry semantics are documented with the durable workflow contract.
