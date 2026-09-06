---
name: coscheduled-test-pair-strands-runs-terminally
---

# Two test files fail deterministically when co-scheduled, and the base-ref probe converts that into terminal stranding

## Problem

`v2/src/commands/workflow.test.ts` and `v2/src/execution/diff-derived-mutation-verifier.test.ts` each pass alone and fail together, reproducibly, **on an idle machine**:

```text
bun test v2/src/commands/workflow.test.ts                       → 104/104   (twice)
bun test v2/src/execution/diff-derived-mutation-verifier.test.ts → 101/101
bun test <both>                                                  → 2 fail
```

Both failures are in `workflow.test.ts` and both land at exactly **5000 ms** — `after detach the workflow reaches workflow entry terminal while the launching CLI has already exited` and `attached run workflow waits through a multi-step workflow until the entry run is terminal`. They are 5-second bounded waits.

The mechanism is that the verifier suite spawns real `bun test` subprocesses of its own — `MAX_CONCURRENT_VERIFIER_TEST_RUNS` is 4 (`v2/src/execution/diff-derived-mutation-verifier.ts:98`) — so co-scheduling it with a suite whose assertions are wall-clock-bounded starves those waits. This is **not** the ambient-load shape already documented in the runbook: measured at load 1.7 with nothing else running.

**The harness then converts the flake into terminal stranding.** A ready gate whose scope contains both files fails; the base-ref reproduction probe re-runs the same pair against `baseRef`, observes the same two failures, and correctly concludes "these paths also reproduce on base" — settling `ready_gate_out_of_scope` with `nextAction: stop` and `resumable: false`. The lane's own work is fine and completely unrelated; there is no resume path, and the operator must salvage by hand.

The out-of-scope settlement is doing exactly what it was designed to do. The defect is that its evidence is gathered under the same co-scheduling that produced the failure, so a flaky pair is indistinguishable from a genuinely broken base.

## Evidence (2026-09-06)

Run `0486d092`, spec `20260905T210307Z-pipeline-external-chained-resolution`, 8 commits, **all 5 subspecs complete with every acceptance criterion ticked**:

```json
{"runStatus":"failed","loopOutcomeKind":"ready_gate_out_of_scope","iterationsConsumed":8,"resumable":false,
 "error":{"reason":"ready_gate_out_of_scope","nextAction":"stop",
 "readyGateOutsidePaths":["v2/src/commands/workflow.test.ts","v2/src/execution/diff-derived-mutation-verifier.test.ts"],
 "readyGateOutOfScopeDetail":"ready gate failing paths also reproduce on main: …"}}
```

Neither named path is in that lane's diff. The lane published nothing and had to be hand-salvaged.

Note also that verifying the claim naively **confirms it**: running the two files together on `main` reproduces the failures, which is how an operator (and the probe) reaches the wrong conclusion. Only isolation distinguishes them.

## Wider than one pair (measured 2026-09-06)

The pairing above is the sharpest reproducer, but the v2 slice is flaky under its own concurrency generally, and **the failing set rotates between runs**:

| `bun run test:v2` on | Failures | Which |
| --- | --- | --- |
| `main` | 2 | `workflow attached entry-terminal wait …`, `diff-derived-mutation-verifier > … reports a surviving mutation when no test covers the changed guard` |
| a salvage branch whose diff touched neither file | 3 | `executeWorkflow external linked implement routing …`, `createCompletionCommitter > honors injected iterationTimeoutMs …`, `worktree render-observer map resolution …` |

Every one of those five settles at **exactly 30000 ms**, and every one passes in isolation. So `main` itself does not pass the local aggregate on an idle machine, while CI stays green because it scopes by changed path and never runs the full union.

That matters for two reasons. First, an operator following the runbook's "run the affected test script before ticking" will see red on `main` and cannot distinguish it from their own breakage — I nearly filed "main is red" before isolating. Second, per-file entries in the existing seam are whack-a-mole if the set rotates.

**The seam already exists**: `LOAD_SENSITIVE_FILES` in `scripts/test-slice.ts:14`, with `isLoadSensitive` forcing no co-runners, and each entry carrying dated loaded-red / idle-green evidence. None of the five files above are listed. The file's own trailing comment anticipates exactly this ("Isolate a specific split file here … if one proves load-sensitive"), so adding entries is the sanctioned move — but a rotating set argues for bounding concurrency for wall-clock-bounded assertions as a class rather than enumerating files one incident at a time.

## Decisions

- Files whose assertions are wall-clock-bounded and files that spawn test subprocesses are not co-scheduled by the test runner; the isolation set is declared rather than discovered per-incident (`LOAD_SENSITIVE_FILES` in `scripts/test-slice.ts:14` is the existing seam); rules out a pairing that fails deterministically in ordinary scoped runs.
- Because the failing set rotates between runs, the fix bounds concurrency for the wall-clock-bounded class rather than enumerating files as each one is observed; rules out per-incident whack-a-mole that leaves `main` red on the local aggregate between discoveries.
- Better, where cheap: the two `workflow.test.ts` waits stop being wall-clock-bounded — they await the durable boundary rather than a 5 s deadline; rules out treating scheduling as the only lever for a test that could be deterministic.
- The base-ref reproduction probe runs each failing path in the **same isolation** it will be judged in, and a path that passes in isolation on both base and branch is not classified out-of-scope; rules out a probe whose evidence is gathered under the condition that caused the failure.
- An `out_of_scope` settlement whose outside-path set consists entirely of paths that pass in isolation is not terminal; rules out `nextAction: stop` on a lane with no defect (same honesty rule as [[terminal-state-honesty-invariant]]).

## Acceptance criteria

- [ ] A test-slice test proves `v2/src/commands/workflow.test.ts` and `v2/src/execution/diff-derived-mutation-verifier.test.ts` are never scheduled in the same concurrent batch; it fails against the current roster.
- [ ] Running the union of both files' resolved slice is green ten consecutive times on an idle machine; it fails against the current pairing.
- [ ] A test proves the base-ref reproduction probe evaluates a failing path in isolation, and that a path passing in isolation on both base and branch is not reported in `readyGateOutsidePaths`; it fails against the current shared-scope probe.
- [ ] A test proves an out-of-scope settlement whose outside paths all pass in isolation projects `resumable: true` / a recovery `nextAction`, not `stop`.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — distinguish this deterministic co-scheduling shape from the ambient-load one already documented; record that isolation, not machine quiet, is the discriminator.
- `v2/docs/test-writing.md` — the isolation set and why wall-clock-bounded assertions cannot share with subprocess-spawning suites.
- `v2/docs/v1-behaviors.md` — record isolation-aware base-ref probing.
