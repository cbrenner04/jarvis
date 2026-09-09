---
name: mutation-verifier-reports-a-survivor-that-three-tests-kill
---

# The mutation verifier reported a survivor on a guard its own killing test kills, then exhausted repair on it

## Problem

Diff-derived mutation verification settled `surviving_mutation_failed` for a mutation that the resolved killing test **does** kill. The lane then spent its full repair budget trying to cover an already-covered guard and settled `mutation_repair_exhausted`, which the runbook documents as terminal and never re-admitted. A complete, correct, fully-covered lane was stranded by a false report.

The runbook already prescribes the flip-and-test check for exactly this, and calls a failing scoped test under the manual mutation evidence of a false positive. What it does not cover is the cost when the false positive survives *into* repair: three agent iterations and a terminal settlement with no admitted recovery.

## Evidence (2026-09-09, run `1e1f893c`)

Reported: `operator-flip: === → !==` at `v2/src/daemon/pipeline-daemon-resolution.ts:123`

```ts
function isNullableNumber(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}
```

Flip-and-test, run by hand per the runbook (file copied first, mutation applied at the exact site, resolved killing test only):

| Tree state | Tests failing under the reported mutation |
| --- | --- |
| at the settlement commit, before any repair | **1** |
| at `HEAD`, after three repair commits | **3** |

Restored and re-verified 9/9 green. So the guard was covered when the verifier called it uncovered, and is now covered three times over.

The three `mutation-repair` commits were also **never pushed** — the resume settled before republishing, so the PR still pointed at the pre-repair commit and its green CI described a tree that no longer existed. An operator merging on that CI result would have merged without the repair work.

One thing worked: the repair agent's added coverage is genuine, not vacuous. Its first added test asserts a non-numeric `dismissedAt` is rejected, which the mutant would accept. So the repair produced real value while chasing a phantom.

## Decisions

- Before settling `surviving_mutation_failed`, the verifier re-runs the resolved killing set against the mutated tree once, in isolation, and treats a failing run as a kill; rules out settling a survivor on the strength of a single possibly-contended execution.
- The settlement records the killing set it actually ran and that set's observed result, so an operator can compare it against a hand flip-and-test without reconstructing the resolution; rules out a report whose only falsification path is re-deriving the killing set by hand.
- Repair commits are pushed before the run settles, whatever the settlement; rules out a PR whose green CI describes a tree the branch no longer has.
- `mutation_repair_exhausted` names the mutation site and the killing set in its operator error; rules out a terminal settlement whose only detail is "survived every repair attempt".

## Acceptance criteria

- [ ] A test proves a mutation whose resolved killing set fails under mutation settles as killed rather than `surviving_mutation_failed`, even when a first execution reported otherwise; it fails against the current single-execution settlement.
- [ ] A test proves the `surviving_mutation_failed` settlement records the resolved killing set and its observed result.
- [ ] A test proves repair commits are pushed before a `mutation_repair_exhausted` settlement, so the branch tip and the PR head agree.
- [ ] A test proves `mutation_repair_exhausted` names the mutation site and killing set in the composed operator error.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — under **Flip-and-test false-positive check**, record that a false positive can reach `mutation_repair_exhausted`, and that the branch tip may be ahead of the PR head after that settlement.
- `v2/docs/write-behavior.md` — record the re-run-before-settling rule and what the settlement carries.
