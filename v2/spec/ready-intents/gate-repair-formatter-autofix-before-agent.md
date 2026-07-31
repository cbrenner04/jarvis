---
name: gate-repair-formatter-autofix-before-agent
---

# Ready-gate repair runs formatter autofix before bounded agent repair

Single execution-loop surface (`publishWithReadyRepair` ready-gate repair); splitting by module boundary does not apply.

## Problem

A red `bun run check` caused only by biome formatting exhausts all three bounded repair
iterations and settles `ready_gate_failed`, because repair hands the gate output back to an agent
instead of running the repo's own `bun run fix`. The operator then runs `bun run fix` by hand and
resumes, and the gate goes green with no agent involvement.

Observed 2026-07-30 on `20260730T043255Z-pipeline-durable-approval-and-reopen-state`: two separate implement attempts
settled `ready_gate_failed` on formatter diffs (plus one `noExcessiveCognitiveComplexity` error that
is genuinely agent work). Twenty run rows on that one branch. Both recoveries were `bun run fix` +
`jarvis run resume`, each green on the next gate.

## Decisions

- After the repair fence allowset is frozen and before the first repair agent runs, every red gate entering repair runs project autofix (`bun run fix` / configured `fixCommand`) once and re-gates — not gated on whether failures look formatter-only; rules out spending agent turns on mechanical formatting the repo can fix itself.
- Autofix is attempted at most once per gate failure; a still-red gate after it falls through to the existing bounded agent repair with its full budget — rules out a fix/re-gate loop.
- Autofix stages only paths already in the frozen allowset; an out-of-scope formatter change is not committed and upgrades fence provenance to `outcomeKind: completion_commit_failed` with the normalized offending path (same shape as post-agent repair staging) — rules out the formatter widening the commit beyond the run diff and spec tree.
- Lint errors that biome cannot autofix (e.g. `noExcessiveCognitiveComplexity`) are unaffected and still reach the agent when the gate stays red after autofix — rules out treating every `check` failure as mechanical.

## Acceptance criteria

- [ ] A pre-fix-failing regression drives a red gate whose only failure is formatter diff: the run runs the formatter, re-gates green, publishes, and consumes zero repair iterations.
- [ ] A red gate mixing formatter diff with a non-autofixable lint error runs the formatter once, then enters agent repair with the full iteration budget; the regression asserts the remaining budget.
- [ ] After fence freeze, autofix stages only allowset paths; a formatter change to an out-of-scope file is not committed and the run settles `completion_commit_failed` naming the offending path.
- [ ] Inverting the autofix-once guard or the fence-allowset filter turns its corresponding regression RED.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — formatter autofix after fence freeze, before the first repair agent; does not consume the repair budget.
- `v2/docs/operator-runbook.md` — update main ready-gate repair prose (~502) for autofix-first ordering; delete the 2026-07-30 "run `bun run fix` and re-gate by hand" stopgap.
- `v2/docs/v1-behaviors.md` — parity baseline for ready-gate repair autofix.
- `v2/docs/workflow-runner.md` — align § Ready gate repair or cross-link to `write-behavior.md`.

## Prerequisites

- Bounded ready-gate repair invokes the agent on red gates, commits, and republishes for up to three attempts; each attempt consumes one write iteration.
- Ready-gate repair fence derives and freezes an allowset from the committed run diff and spec tree before the first repair agent runs.
- Deadline-killed ready gates settle without entering the repair loop or consuming iterations.
