# 00 - Uncommitted-ticks finish path continues when index items remain

When the harness commits uncommitted ticks for a completed subspec (`git: true`
only; `iteration.ts` uncommitted-ticks block) and calls `tryFinishSpecIfDone`, a
multi-subspec index with remaining unchecked linked subspecs causes
`tryFinishSpecIfDone` to return `null`. The caller at `iteration.ts:657`
currently coalesces `null` to `0` via `?? 0`, then may emit `completed-spec`
telemetry and exit with `criteria-complete` — no agent runs for the next subspec.

Fix: when `tryFinishSpecIfDone` returns `null` at this call site, return
`{ kind: "continue" }` immediately — before `?? 0`, `completionLoopbackSignal`
handling, `completed-spec` telemetry, or
`{ kind: "return", exitCode: … }`. Numeric returns (`0`, `6`, gate loopback
codes) keep the existing finish path.

## Decisions

- When `tryFinishSpecIfDone` returns `null` after an uncommitted-ticks commit, return `{ kind: "continue" }` before any finish telemetry or terminal return — rules out post-coalesce branching or falsy-wide handling that emits false completion telemetry.
- Only `null` loops back at this call site; numeric `tryFinishSpecIfDone` returns keep the existing finish path — rules out treating all falsy/`null`-like outcomes uniformly.
- `null` → `continue` only at the uncommitted-ticks finish call site (`iteration.ts:657`); other `tryFinishSpecIfDone` call sites unchanged — rules out widening the fix to `before === 0` / `after === 0` paths.
- Regression test uses `maxIterations >= 2` — rules out a `maxIterations: 1` fixture that passes on “no exit 0” without reaching subspec 01.
- Durable symptom cataloged in `v2/docs/` and `v1/docs/run-loop.md`; any `operator-runbook.md` entry is a stopgap removed on spec merge — rules out `operator-runbook.md` as the sole durable home.
- Do not change `mapExitCodeToReason(0)` in this slice — rules out conflating exit-code labeling with the continuation bug.

## Tasks

- [ ] At `iteration.ts:657`, when `tryFinishSpecIfDone` returns `null`, return `{ kind: "continue" }` before `?? 0`, `completionLoopbackSignal`, `completed-spec` telemetry, or terminal `return { kind: "return", exitCode: … }`; numeric returns unchanged.
- [ ] Add regression test: multi-subspec index (`00`, `01`), `maxIterations >= 2`, uncommitted ticks on subspec 00 only — verify subspec-00 commit in git history, committed index `- [x]` on 00 and `- [ ]` on 01, no exit `0`, first agent prompt targets subspec 01.
- [ ] `v2/docs/v1-behaviors.md`: uncommitted-ticks finish path continues when index tasks remain.
- [ ] `v1/docs/run-loop.md`: extend uncommitted-ticks / exit-6 row — multi-subspec false `criteria-complete` symptom (`criteria-complete` + `iterations: 0` without harness `spec complete` on stdout) and post-subspec continuation after uncommitted-ticks commit.
- [ ] (Optional stopgap) `v1/docs/operator-runbook.md` under an existing section (not scaffold-only `Known gotchas`): same symptom pair; remove on spec merge.
- [ ] Run `bun run typecheck` and relevant tests (`run.test.ts`).

## Acceptance criteria

- [x] Uncommitted-ticks completion commit on a multi-subspec index where more subspecs remain does **not** exit `0`; the harness returns `{ kind: "continue" }` before any `completed-spec` telemetry or terminal finish return.
- [x] Regression test: multi-subspec index, `maxIterations >= 2`, uncommitted ticks on subspec 00 only — subspec-00 commit in git history; committed index `- [x]` on 00 and `- [ ]` on 01; no exit `0`; first agent prompt references subspec 01.
- [x] `run.test.ts` “uncommitted ticks present at iteration start are committed and advance the spec (no deadlock)” stays green.
- [x] `v2/docs/v1-behaviors.md` records uncommitted-ticks finish path continues when index tasks remain.
- [x] `v1/docs/run-loop.md` documents multi-subspec false `criteria-complete` triage (`criteria-complete` + `iterations: 0` without `spec complete` on stdout) and post-subspec continuation after uncommitted-ticks commit.

## Documentation updates

- `v2/docs/v1-behaviors.md` — behavior entry under `### Patch-mode run workflow`.
- `v1/docs/run-loop.md` — extend uncommitted-ticks / exit-6 row for multi-subspec false `criteria-complete` and post-subspec continuation.
- `v1/docs/operator-runbook.md` — optional stopgap under an existing section; delete on spec merge.
