# Operator session — 2026-08-03T20:30Z

Base `04cf5ce1f` → `b579778eb`. **27 PRs merged**, one open by design (#2555, a DO-NOT-MERGE record). 82 files, +4316/−347. `main` green.

## Shipped

### TUI slice 5 — the command dock became functional

| PR | What |
| --- | --- |
| [#2540](https://github.com/cbrenner04/jarvis/pull/2540) | plan: tui-command-editor |
| [#2545](https://github.com/cbrenner04/jarvis/pull/2545) | Command focus and editing — `:`/`/`, grapheme cursor, `Esc`, `Enter` |
| [#2548](https://github.com/cbrenner04/jarvis/pull/2548) | plan: tui-command-dispatch |
| [#2554](https://github.com/cbrenner04/jarvis/pull/2554) | Admission binding + dispatch — typed `start` reaches `admitPipelineStart` on CLI seams, detached |

Slice 5 began the session as "a parser and an admission API with no caller." It now edits and dispatches. Subspecs 02-04 remain.

### Codex cost visibility

| PR | What |
| --- | --- |
| [#2556](https://github.com/cbrenner04/jarvis/pull/2556) | seed: corrected diagnosis |
| [#2557](https://github.com/cbrenner04/jarvis/pull/2557) | intent split |
| [#2558](https://github.com/cbrenner04/jarvis/pull/2558) | plan: telemetry-rows-carry-adapter-warnings |
| [#2559](https://github.com/cbrenner04/jarvis/pull/2559) | Adapter warnings reach telemetry rows |
| [#2560](https://github.com/cbrenner04/jarvis/pull/2560) | plan: finalize-codex-session-usage |
| [#2561](https://github.com/cbrenner04/jarvis/pull/2561) | **Codex usage and computed cost** |

The existing seed was wrong and would have wasted a run: it said "add codex usage parsing," but parsing, discovery, cwd matching and marker matching all already worked. The real defect was one line — `runCodexBinding` resolved the rollout and returned `result` untouched. Only the failure branch was ever implemented.

Proven without guessing: all 45 successful codex rows recorded `cost_source: "unavailable"` (the `runAgent` default) rather than `"no-usage"` (what the not-found branch writes), so the rollout was found every time and discarded.

### Pipeline trustworthiness

| PR | What |
| --- | --- |
| [#2542](https://github.com/cbrenner04/jarvis/pull/2542) | intent split of the fan-out seed |
| [#2544](https://github.com/cbrenner04/jarvis/pull/2544) | plan (later retired) |
| [#2552](https://github.com/cbrenner04/jarvis/pull/2552), [#2553](https://github.com/cbrenner04/jarvis/pull/2553) | spec amendments (later shown to be the wrong repair) |
| [#2562](https://github.com/cbrenner04/jarvis/pull/2562) | **seed: rescope**, retiring the disproven spec |
| [#2563](https://github.com/cbrenner04/jarvis/pull/2563) | intent split into three seams |
| [#2564](https://github.com/cbrenner04/jarvis/pull/2564) | plan: stage-entry-run-linkage |
| [#2566](https://github.com/cbrenner04/jarvis/pull/2566) | **Stage linkage follows the admitted entry run** — the reported bug, fixed |

### Other

[#2541](https://github.com/cbrenner04/jarvis/pull/2541) execution-loop human-only contracts · [#2546](https://github.com/cbrenner04/jarvis/pull/2546)/[#2547](https://github.com/cbrenner04/jarvis/pull/2547)/[#2549](https://github.com/cbrenner04/jarvis/pull/2549) completion-commit error detail (via pipeline) · seeds [#2543](https://github.com/cbrenner04/jarvis/pull/2543), [#2550](https://github.com/cbrenner04/jarvis/pull/2550), [#2551](https://github.com/cbrenner04/jarvis/pull/2551), [#2565](https://github.com/cbrenner04/jarvis/pull/2565), [#2567](https://github.com/cbrenner04/jarvis/pull/2567)

## The rescope

The fan-out spec was built on a premise adversarial review disproved: **destination worktrees were already distinct from the predecessor on `main`.** Reverting `resolvePlanStage` to baseline semantics left both ownership regressions green. The shipped `destinationDistinctFromPredecessor` predicate had no production call site.

It cost three implement attempts (two blocked on hollow mutation checkpoints, one producing a red gate and dead code), two spec amendments, and a hand fold-in — before anyone questioned the premise.

The signal was there and I misread it. Two hollow checkpoints on *different* guards is not a proof-form problem; it means the spec is defending against something that cannot happen. I amended the criterion twice instead, which let the third attempt through to produce inert code that passed its own tests.

The rescoped seed carries a **Non-problems** section naming the disproven predicates, and its first intent shipped in one pass with every guard proven reachable. Seed [#2565](https://github.com/cbrenner04/jarvis/pull/2565) moves the check to plan **review** — before implementation, where there is still nothing to build — because a completion-time check has already lost the run.

## Two mistakes of mine worth recording

**I called #2555 "fully green" when `test:v2` exited 1.** My aggregation summed reported pass/fail lines; `pipeline-execution.test.ts` hung and its 69 tests never reported, contributing nothing to the count. Read as "2611 pass / 0 fail."

**On #2561 the fix was never committed.** The mutate/restore cycle left mutated text in place, I committed that, and read `bun run check`'s `tail -1` as passing when it was failing on format. Had it merged, codex cost would have been 40% too high — replacing "no data" with "wrong data."

Both are the same error: measuring output text instead of exit codes. Every gate check since has used exit codes, and every mutate/restore cycle now ends with a byte-identical tree diff.

## Pipeline dogfooding

`jarvis pipeline start` on a real seed produced #2546/#2547/#2549 but did not reach its terminal action. Three defects found, two of them only because I was driving it:

- **Merging the pipeline's own green plan PR kills it** — the implement stage bases its PR on the plan branch, so merging deletes the base ref (`Base ref must be a branch`). Seeded #2550.
- **`pipeline wait` cannot track an approved branch** — it returns instantly on un-approved sibling gates.
- **The intent stage split a small observability seed into four dependency-chained branches** the pipeline models as independent siblings.

Tool split that emerged: pipelines for **seeds**, standalone workflows for anything already past the intent stage.

## Harness defects seeded

| Seed | PR |
| --- | --- |
| Unparseable `@mutate` directives pass the gate | [#2543](https://github.com/cbrenner04/jarvis/pull/2543) |
| Pipeline implement stage breaks when its plan PR merges | [#2550](https://github.com/cbrenner04/jarvis/pull/2550) |
| Plan output fails `lint:md`; repair edits unrelated source | [#2551](https://github.com/cbrenner04/jarvis/pull/2551) |
| Plan review must falsify guard premises | [#2565](https://github.com/cbrenner04/jarvis/pull/2565) |
| Settlement can terminalize a live-linked stage | [#2567](https://github.com/cbrenner04/jarvis/pull/2567) |

**The unparseable-directive gap fired four times** — a directive whose target text is absent or ambiguous is stderr-only and does not fail the gate. One of those let the codex cost over-bill tick green. Highest-value open seed.

## The through-line

**Four runs ticked every criterion while their gate was red or never ran.** `iteration_timeout` (×2), `idle_output_timeout`, and `completion_commit_failed` all kill a run *before* finalization — so the ready gate never executes, and nothing verifies the criteria the agent just ticked. Every one needed the full gate re-run by hand, and three had real defects hiding behind the false green: a production null-deref, a no-op cached-input subtraction, and complexity-40 code.

Six adversarial reviews ran; **every one found something real**, including two `DO NOT MERGE` verdicts on work I had called green.

## Agents

Codex led as requested until it hit its usage limit at 01:50Z ("try again at Aug 8th"), then cursor with claude behind it. 106 invocations: codex 58, cursor 43, claude 5. Measurable agent spend **$16.26** (cursor $10.04, claude $6.21) — codex's 58 are unmeasurable, which is exactly the gap #2561 closes going forward.

## Open at close

**#2555** — deliberately open, retitled DO-NOT-MERGE, body carrying the full review findings. It is the record of the retired spec; close it when the rescoped seams land.

## Next

1. `20260803T013930Z-tui-command-dispatch/` subspecs 02-04 — finishes slice 5.
2. `fan-out-concurrent-sibling-dispatch`, then `pipeline-stage-dispatch-claim`.
3. `seeds/unparseable-mutation-directives-pass-the-gate` — four hits in one session.
