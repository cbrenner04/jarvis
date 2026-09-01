---
name: terminal-settlement-guard-inventory-is-line-brittle
---

# Terminal-settlement guard inventory embeds absolute line numbers and breaks on any line shift

## Problem

`v2/src/execution/execution-terminal-settlement-guard.test.ts` enforces the atomic-settlement invariant by scanning production execution sources and comparing the found terminal-write sites against a hardcoded `PERMITTED_TERMINAL_WRITES` / `PERMITTED_NONTERMINAL_SET_RUN_STATUS` inventory. Both inventory entries and the comparison key (`terminalWriteKey`) embed the **absolute line number** of each call site. Any commit that inserts lines above a tracked site in `workflow-runner.ts` or `write-loop.ts` — including edits with nothing to do with terminal settlement, and clean merges of unrelated branches — shifts those line numbers and reddens the guard, forcing a manual inventory refresh. The actual invariant (`violations` empty: no terminal write bypasses `commitTerminalRunSettlement`/`commitCompletionBoundary`) can be fully intact while the test is red purely on line drift.

## Evidence

Landing `execution-terminal-run-settlement-invariant` subspec 02 (2026-09-01): merging current `main` into the branch (clean, no conflicts) shifted ~40 of ~41 inventoried sites; `test:v2` went red with a pure line-drift mismatch (every `missing` entry paired with an identical-file/function/writer `extra` entry, only the line differing), `violations` empty. Had to regenerate the whole inventory from the scan to land. This will recur on every future PR that adds lines above a tracked site.

## Decisions

- Key the inventory on `(file, functionName, writer/status)` without the line number — the invariant is "which functions may write terminal state via which writer," not "at which line." Drop `line` from `terminalWriteKey` / `nonterminalSetRunStatusKey` (keep `line` in the reported violation for humans, just not in the equality key).
- Alternatively/additionally: allow multiple permitted sites per (file, function, writer) as a count, so intra-function additions don't need per-line entries.
- The guard must still fail on a genuinely new/unpermitted terminal write and on a nonterminal→terminal `setRunStatus` (the mutation-checkpoint test must keep passing).

## Acceptance criteria

- [ ] Inserting blank lines above a tracked call site (no new terminal write) does not red the guard — pinned by a test that shifts line numbers and asserts the guard stays green.
- [ ] Adding an unpermitted terminal write in a production execution source still reds the guard with a `terminalSetRunStatus`/`unsettledTerminalBoundary` violation — pinned (extends the existing checkpoint test).
- [ ] The permitted inventory no longer stores absolute line numbers in its equality key.
- [ ] `bun run typecheck` and the `test:v2` pair pass.

## Documentation updates

- Update the subspec-authored guard's own header comment to state the line-independent keying.
