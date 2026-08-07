# Markdown-only plan/intent outside-diff repair settlement isolation

## Problem

Issue #2712 proposed `shouldSettleMarkdownOnlyOutOfScopeRepair` in `publishWithReadyRepair` to settle `ready_gate_out_of_scope` instead of `completion_commit_failed` when a markdown-only plan/intent completion's gate failure is fully outside the run diff and repair would stage only non-markdown paths. Disabling the guard left drafted settlement regressions green (attributable untouched-path settlement already returns `ready_gate_out_of_scope`), and mutation checkpoints were hollow or false-reddened via compile error (directive matched both function definition and call site). This subspec adds isolation regressions first, then either pins existing behavior or ships the guard with non-hollow checkpoints.

Reachable on main today: `write-loop.test.ts` `untouched-path gate settlement` exercises attributable outside-diff settlement on implement-shaped loops with `baseRefProbeFailsSeam`; `ready-gate repair fence` exercises markdown-fence `completion_commit_failed` on plan/intent loops via in-scope `lintMdOnly` gate failures — not the #2712 settlement question.

## Prerequisites

- No-test-impact plan/intent completion diffs resolve to empty `JARVIS_READY_TEST_SCOPE` when the base ref is unresolvable (`scripts/ci-test-scope.ts`, landed #2712).
- Fully attributed untouched-path gate failures whose paths reproduce on base ref settle `ready_gate_out_of_scope` without repair (`publishWithReadyRepair` / `untouched-path gate settlement` regressions).
- Markdown-only plan/intent workflows persist `markdownOutputRoots` on the repair fence and refuse repair commits staging paths outside those roots (`findFirstMarkdownOnlyFenceViolation`; `ready-gate repair fence` plan/intent regressions).
- `classifyReadyGatePublishFailure` can leave `ready_gate_failed` when base-ref probe errors mark outside paths in-scope (`baseRefProbeError` on `ReadyGateError`; `ready-finalize.test.ts` `base-ref probe failure classifies in scope`).

## Decision ledger

- Add plan and intent isolation regressions in `write-loop.test.ts` before any new settlement guard — rules out re-landing hollow dead code from #2712.
- Isolation fixtures use `runRepairFenceLoop` with `planRepairLoopDefaults` / `intentRepairLoopDefaults` (or equivalent `landing` / `specPath` / `markdownOutputRoots`); iteration commits change **only** markdown/plan-stage paths; gate failure is on a path **outside** both `markdownOutputRoots` **and** the run diff (`gateFailureOutput` on e.g. `v2/src/untouched.test.ts`), not `lintMdOnly` on a markdown path — rules out markdown-fence `completion_commit_failed` without exercising `publishWithReadyRepair` settlement.
- `initPlanRepairFenceWorktree` / `initIntentRepairFenceWorktree` stage non-markdown paths in the iteration commit; reuse only with explicit overrides: `gateFailurePath` away from markdown defaults, `lintMdOnly: false`, `gateFailureOutput` on the outside-diff path — rules out conflating markdown-fence refusal with settlement.
- **Redundancy discovery seam:** `baseRefProbeFailsSeam` (or equivalent early out-of-scope settlement before repair).
- **Guard-needed discovery seam:** swap to a `ready_gate_failed`-leaving seam so repair runs before settlement (e.g. base-ref probe error/pass pattern from `write-loop.test.ts` `logs ready_gate_base_ref_probe before ready_gate_repair when base-ref probe errors`) — rules out wiring that skips repair on the guard path.
- If discovery settles `ready_gate_out_of_scope`: omit `shouldSettleMarkdownOnlyOutOfScopeRepair`; treat as characterization/preservation (new pins lock existing behavior; not failing-test-first behavior change); no operator docs.
- If discovery settles `completion_commit_failed`: add `shouldSettleMarkdownOnlyOutOfScopeRepair` in `publishWithReadyRepair` before markdown/run-diff fence refusal when markdown-only and staged repair paths are all outside `markdownOutputRoots`; pin with one plan-regression `Mutation checkpoint:` on a call-site-unique `// @mutate` (includes an argument token; must not match the function definition) and one `Keystone checkpoint:` reverting headline settlement (`ready_gate_out_of_scope` → `completion_commit_failed`) — rules out compile-error false-redden and inert headline changes.
- Intent regression asserts same `result.kind` and matching repair telemetry as the plan regression; no second `@mutate` pin — rules out duplicate guard checkpoints for shared `publishWithReadyRepair` logic.
- If discovery yields neither `ready_gate_out_of_scope` nor `completion_commit_failed`, append `## Blocker` and stop — discovery failed.
- Deferred to first consumer: exact `// @mutate` directive text for `shouldSettleMarkdownOnlyOutOfScopeRepair` call site and keystone revert line — pin when guard ships.

## Task checklist

- Add `write-loop.test.ts` regression `markdown-only plan completion settles outside-diff ready gate`: `runRepairFenceLoop` with `planRepairLoopDefaults`, worktree from `initPlanRepairFenceWorktree` with markdown-only iteration commit (only plan-stage paths), explicit overrides (`gateFailurePath` outside `markdownOutputRoots` and run diff, `lintMdOnly: false`, `gateFailureOutput` on that path), `readyGateScopeSeams: baseRefProbeFailsSeam` for redundancy discovery; assert `result.kind` and repair telemetry.
- Add `write-loop.test.ts` regression `markdown-only intent completion settles outside-diff ready gate`: same contract via `intentRepairLoopDefaults` and `initIntentRepairFenceWorktree` with markdown-only iteration commit and the same overrides.
- **Discovery:** run both regressions on baseline without new production code; branch on observed `result.kind` — `ready_gate_out_of_scope` → redundancy path; `completion_commit_failed` → guard path; anything else → `## Blocker` and stop.
- **Redundancy path:** if `ready_gate_out_of_scope`, assert no `ready_gate_repair` events; no repair edit in fixture; stop — no production changes, no docs.
- **Guard path:** swap plan and intent regressions to a `ready_gate_failed`-leaving seam; repair edit stages a non-markdown path so repair runs before settlement; implement `shouldSettleMarkdownOnlyOutOfScopeRepair` in `publishWithReadyRepair`; add plan-regression `// @mutate` on the guard call site and keystone `// @mutate` reverting headline settlement; update `v2/docs/operator-runbook.md` § Gate trust and `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [x] `v2/src/execution/write-loop.test.ts` — `markdown-only plan completion settles outside-diff ready gate` uses a markdown-only plan completion fixture (iteration commit changes only markdown/plan-stage paths), `gateFailurePath` and `gateFailureOutput` on a path outside both `markdownOutputRoots` and the run diff with `lintMdOnly: false`, redundancy-discovery seam `baseRefProbeFailsSeam` (guard path: `ready_gate_failed`-leaving seam per decision ledger), asserts `result.kind === "ready_gate_out_of_scope"`.
- [x] `v2/src/execution/write-loop.test.ts` — `markdown-only intent completion settles outside-diff ready gate` uses a markdown-only intent completion fixture with the same outside-diff gate failure and seam choice; asserts the same `result.kind` and matching repair telemetry as the plan regression; no second `@mutate` pin.
- [x] Redundancy path (N/A when discovery selects guard): `v2/src/execution/write-loop.test.ts` — `markdown-only plan completion settles outside-diff ready gate` and `markdown-only intent completion settles outside-diff ready gate` stay green with no `shouldSettleMarkdownOnlyOutOfScopeRepair` production change and assert no `ready_gate_repair` events (characterization pins).
- [x] **Discovery outcome: redundancy.** Both regressions settle `ready_gate_out_of_scope` on baseline with no production change — the existing attributable untouched-path settlement (`write-loop.ts` gate-failure classification, verified: both regressions redden when that `ready_gate_out_of_scope` → `ready_gate_failed` branch is inverted) already handles markdown-only outside-diff gate failures. `shouldSettleMarkdownOnlyOutOfScopeRepair` is therefore redundant and NOT shipped; the guard-path criteria (guard regression, mutation checkpoint, keystone checkpoint) are N/A. The two regressions above stand as characterization pins.
- [x] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- None when discovery selects redundancy.
- If guard ships: `v2/docs/operator-runbook.md` § Gate trust — markdown-only plan/intent completions whose outside-diff gate failure would be repaired only by staging non-markdown paths settle `ready_gate_out_of_scope` instead of `completion_commit_failed`.
- If guard ships: `v2/docs/v1-behaviors.md` — same settlement behavior for markdown-only plan/intent completion ready-gate repair.

## Blocker

Artifact contract check failed: Unticked non-human-only acceptance criteria:
- `v2/src/execution/write-loop.test.ts` — `markdown-only plan completion settles outside-diff ready gate` uses a markdown-only plan completion fixture (iteration commit changes only markdown/plan-stage paths), `gateFailurePath` and `gateFailureOutput` on a path outside both `markdownOutputRoots` and the run diff with `lintMdOnly: false`, redundancy-discovery seam `baseRefProbeFailsSeam` (guard path: `ready_gate_failed`-leaving seam per decision ledger), asserts `result.kind === "ready_gate_out_of_scope"`.
- `v2/src/execution/write-loop.test.ts` — `markdown-only intent completion settles outside-diff ready gate` uses a markdown-only intent completion fixture with the same outside-diff gate failure and seam choice; asserts the same `result.kind` and matching repair telemetry as the plan regression; no second `@mutate` pin.
- Redundancy path (N/A when discovery selects guard): `v2/src/execution/write-loop.test.ts` — `markdown-only plan completion settles outside-diff ready gate` and `markdown-only intent completion settles outside-diff ready gate` stay green with no `shouldSettleMarkdownOnlyOutOfScopeRepair` production change and assert no `ready_gate_repair` events (characterization pins).
- Guard path (N/A when discovery selects redundancy): `v2/src/execution/write-loop.test.ts` — `markdown-only plan completion settles outside-diff ready gate` fails against the pre-fix code and passes after the guard, asserting `ready_gate_out_of_scope`.
- Guard path (N/A when discovery selects redundancy): Mutation checkpoint: in `v2/src/execution/write-loop.test.ts` test `markdown-only plan completion settles outside-diff ready gate`, a `// @mutate` directive unique to the `shouldSettleMarkdownOnlyOutOfScopeRepair` call site (includes an argument token; does not match the function definition) turns that regression RED via failed assertion, not compile error — not tickable until the directive exists.
- Guard path (N/A when discovery selects redundancy): Keystone checkpoint: in `v2/src/execution/write-loop.test.ts` test `markdown-only plan completion settles outside-diff ready gate`, a `// @mutate` directive reverts the headline settlement change (`ready_gate_out_of_scope` → `completion_commit_failed`) and turns that regression RED — not tickable until the directive exists.
- `bun run typecheck` and `bun run test:v2` pass.
