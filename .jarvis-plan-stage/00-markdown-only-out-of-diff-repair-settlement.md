# Markdown-only plan/intent outside-diff repair settlement isolation

## Problem

Issue #2712 proposed `shouldSettleMarkdownOnlyOutOfScopeRepair` in `publishWithReadyRepair` to settle `ready_gate_out_of_scope` instead of `completion_commit_failed` when a markdown-only plan/intent completion's gate failure is fully outside the run diff and repair would stage only non-markdown paths. Disabling the guard left drafted settlement regressions green (attributable untouched-path settlement already returns `ready_gate_out_of_scope`), and mutation checkpoints were hollow or false-reddened via compile error (directive matched both function definition and call site). This subspec adds isolation regressions first, then either records redundancy and pins existing behavior or ships the guard with non-hollow checkpoints.

Reachable on main today: `write-loop.test.ts` `untouched-path gate settlement` exercises attributable outside-diff settlement on implement-shaped loops with `baseRefProbeFailsSeam`; `ready-gate repair fence` exercises markdown-fence `completion_commit_failed` on plan/intent loops via in-scope `lintMdOnly` gate failures — not the #2712 settlement question.

## Prerequisites

- No-test-impact plan/intent completion diffs resolve to empty `JARVIS_READY_TEST_SCOPE` when the base ref is unresolvable (`scripts/ci-test-scope.ts`, landed #2712).
- Fully attributed untouched-path gate failures whose paths reproduce on base ref settle `ready_gate_out_of_scope` without repair (`publishWithReadyRepair` / `untouched-path gate settlement` regressions).
- Markdown-only plan/intent workflows persist `markdownOutputRoots` on the repair fence and refuse repair commits staging paths outside those roots (`findFirstMarkdownOnlyFenceViolation`; `ready-gate repair fence` plan/intent regressions).
- `classifyReadyGatePublishFailure` can leave `ready_gate_failed` when base-ref probe errors mark outside paths in-scope (`baseRefProbeError` on `ReadyGateError`; `ready-finalize.test.ts` `base-ref probe failure classifies in scope`).

## Decision ledger

- Add plan and intent isolation regressions in `write-loop.test.ts` before any new settlement guard — rules out re-landing hollow dead code from #2712.
- Isolation fixtures are markdown-only plan-tree and intent-stage completions (`planRepairLoopDefaults` / `intentRepairLoopDefaults` shapes); gate failure is a fully attributed outside-diff path (`gateFailureOutput` on a path outside markdown workflow roots, e.g. `v2/src/untouched.test.ts`), not `lintMdOnly` on a markdown path — rules out markdown-fence `completion_commit_failed` without exercising `publishWithReadyRepair` settlement.
- Default `readyGateScopeSeams`: `baseRefProbeFailsSeam`; if baseline settlement is already `ready_gate_out_of_scope`, record redundancy and omit `shouldSettleMarkdownOnlyOutOfScopeRepair` — rules out a second settlement path that duplicates observable behavior.
- If baseline settlement is `completion_commit_failed`, swap to a `ready_gate_failed`-leaving seam (`reproduceReadyGateAtBaseRef` error or pass per `write-loop.test.ts` `logs ready_gate_base_ref_probe before ready_gate_repair when base-ref probe errors`) so repair enters before fence refusal — rules out conflating markdown-fence refusal with settlement.
- If redundancy: treat as characterization/preservation (new pins lock existing behavior; not failing-test-first behavior change); no operator docs.
- If guard ships: add `shouldSettleMarkdownOnlyOutOfScopeRepair` in `publishWithReadyRepair` before markdown/run-diff fence refusal when markdown-only and staged repair paths are all outside `markdownOutputRoots`; pin with one plan-regression `Mutation checkpoint:` on a call-site-unique `// @mutate` (includes an argument token; must not match the function definition) and one `Keystone checkpoint:` reverting headline settlement (`ready_gate_out_of_scope` → `completion_commit_failed`) — rules out compile-error false-redden and inert headline changes.
- Intent regression asserts settlement parity with the plan regression; no second `@mutate` pin — rules out duplicate guard checkpoints for shared `publishWithReadyRepair` logic.
- Deferred to first consumer: exact `// @mutate` directive text for `shouldSettleMarkdownOnlyOutOfScopeRepair` call site and keystone revert line — pin when guard ships.

## Task checklist

- Add `write-loop.test.ts` regression `markdown-only plan completion settles outside-diff ready gate`: markdown-only plan fixture (`initPlanRepairFenceWorktree`, `planRepairLoopDefaults`), outside-diff `gateFailureOutput`, `readyGateScopeSeams: baseRefProbeFailsSeam` (or `ready_gate_failed`-leaving seam if baseline strands), repair edit staging a non-markdown path if repair runs; assert observed settlement outcome and no `ready_gate_repair` when outcome is `ready_gate_out_of_scope`.
- Add `write-loop.test.ts` regression `markdown-only intent completion settles outside-diff ready gate`: same contract on intent fixture (`initIntentRepairFenceWorktree`, `intentRepairLoopDefaults`).
- Run both regressions on baseline without new production code; record observed `result.kind` in the subspec decision ledger (redundancy vs guard-needed).
- If redundancy: stop — no production changes, no docs.
- If guard needed: implement `shouldSettleMarkdownOnlyOutOfScopeRepair` in `publishWithReadyRepair`; add plan-regression `// @mutate` on the guard call site and keystone `// @mutate` reverting headline settlement; update `v2/docs/operator-runbook.md` § Gate trust and `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [ ] `v2/src/execution/write-loop.test.ts` — `markdown-only plan completion settles outside-diff ready gate` uses a markdown-only plan completion fixture, an outside-diff gate failure, `baseRefProbeFailsSeam` or an equivalent `ready_gate_failed`-leaving seam, and asserts the baseline settlement outcome; if baseline is `ready_gate_out_of_scope`, the subspec decision ledger records redundancy and no guard is added; if baseline is `completion_commit_failed`, the guard is added and removing it fails this regression.
- [ ] `v2/src/execution/write-loop.test.ts` — `markdown-only intent completion settles outside-diff ready gate` uses a markdown-only intent completion fixture with the same seam and outside-diff gate failure and asserts settlement parity with the plan regression; no second `@mutate` pin.
- [ ] If guard ships: `v2/src/execution/write-loop.test.ts` — `markdown-only plan completion settles outside-diff ready gate` fails against the pre-fix code and passes after the guard, asserting `ready_gate_out_of_scope`.
- [ ] If guard ships: Mutation checkpoint: in `v2/src/execution/write-loop.test.ts` test `markdown-only plan completion settles outside-diff ready gate`, a `// @mutate` directive unique to the `shouldSettleMarkdownOnlyOutOfScopeRepair` call site (includes an argument token; does not match the function definition) turns that regression RED via failed assertion, not compile error.
- [ ] If guard ships: Keystone checkpoint: in `v2/src/execution/write-loop.test.ts` test `markdown-only plan completion settles outside-diff ready gate`, a `// @mutate` directive reverts the headline settlement change (`ready_gate_out_of_scope` → `completion_commit_failed`) and turns that regression RED.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- None when redundancy is recorded.
- If guard ships: `v2/docs/operator-runbook.md` § Gate trust — markdown-only plan/intent completions whose outside-diff gate failure would be repaired only by staging non-markdown paths settle `ready_gate_out_of_scope` instead of `completion_commit_failed`.
- If guard ships: `v2/docs/v1-behaviors.md` — same settlement behavior for markdown-only plan/intent completion ready-gate repair.
