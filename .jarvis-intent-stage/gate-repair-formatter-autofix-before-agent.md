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

Observed 2026-07-30 on `pipeline-durable-approval-and-reopen-state`: two separate implement attempts
settled `ready_gate_failed` on formatter diffs (plus one `noExcessiveCognitiveComplexity` error that
is genuinely agent work). Twenty run rows on that one branch. Both recoveries were `bun run fix` +
`jarvis run resume`, each green on the next gate.

## Decisions

- Before the first repair iteration, a red gate whose failures are entirely formatter-autofixable runs project autofix (`bun run fix` / configured `fixCommand`) and re-gates without consuming a repair iteration — rules out spending agent turns on mechanical formatting.
- Autofix is attempted at most once per gate failure; a still-red gate after it falls through to the existing bounded agent repair with its full budget — rules out a fix/re-gate loop.
- Only paths already in the repair fence's allowset are staged from the autofix — rules out the formatter widening the commit beyond the run diff and spec tree.
- Lint errors that biome cannot autofix (e.g. `noExcessiveCognitiveComplexity`) are unaffected and still reach the agent — rules out treating every `check` failure as mechanical.

## Acceptance criteria

- [ ] A pre-fix-failing regression drives a red gate whose only failure is formatter diff: the run runs the formatter, re-gates green, publishes, and consumes zero repair iterations.
- [ ] A red gate mixing formatter diff with a non-autofixable lint error runs the formatter once, then enters agent repair with the full iteration budget; the regression asserts the remaining budget.
- [ ] The autofix stages only fence-allowed paths; a formatter change to an out-of-scope file is not committed and the run reports it.
- [ ] Inverting the autofix-once guard or the fence-allowset filter turns its corresponding regression RED.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — formatter autofix precedes bounded agent repair and does not consume the budget.
- `v2/docs/operator-runbook.md` — delete the "run `bun run fix` and re-gate by hand" stopgap when this ships.

## Prerequisites

- Bounded ready-gate repair invokes the agent on red gates, commits, and republishes for up to three attempts; each attempt consumes one write iteration.
- Ready-gate repair fence derives and freezes an allowset from the committed run diff and spec tree before the first repair agent runs.
- Deadline-killed ready gates settle without entering the repair loop or consuming iterations.
