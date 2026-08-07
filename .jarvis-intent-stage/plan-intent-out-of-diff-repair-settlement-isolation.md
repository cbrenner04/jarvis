---
name: plan-intent-out-of-diff-repair-settlement-isolation
---

# Markdown-only out-of-diff repair settlement: prove redundancy or isolate guard

Single execution-loop surface (`publishWithReadyRepair` settlement and pinning regressions in `write-loop.test.ts`); splitting by module boundary does not apply.

## Problem

The #2712 settlement half proposed `shouldSettleMarkdownOnlyOutOfScopeRepair` in `publishWithReadyRepair` to settle `ready_gate_out_of_scope` instead of `completion_commit_failed` when a markdown-only plan/intent completion's gate failure is fully outside the run diff and repair would stage only non-markdown paths. It was dropped: disabling the guard left drafted settlement regressions green (attributable untouched-path settlement already returns `ready_gate_out_of_scope`), and mutation checkpoints were hollow or false-reddened via compile error (directive matched both function definition and call site).

## Decisions

- Add an isolation regression for markdown-only plan and intent completions whose gate failure is fully outside the run diff on a `ready_gate_failed`-leaving path (e.g. `baseRefProbeError`) before adding any new settlement guard — rules out re-landing hollow dead code from #2712.
- If that regression already settles `ready_gate_out_of_scope` via existing attributable untouched-path settlement, omit `shouldSettleMarkdownOnlyOutOfScopeRepair` and record redundancy in the subspec — rules out a second settlement path that duplicates observable behavior.
- If the regression strands on `completion_commit_failed`, add the guard and pin it with a call-site-unique `// @mutate` that includes an argument token and does not match the function definition — rules out compile-error false-redden from dual-match keystone directives.

## Acceptance criteria

- [ ] `write-loop.test.ts` — regression(s) titled for markdown-only plan and intent completions drive a gate failure fully outside the run diff on a `ready_gate_failed`-leaving path and assert the current (pre-guard) settlement outcome; if already `ready_gate_out_of_scope`, the subspec documents redundancy and no guard is added; if it strands on `completion_commit_failed`, the guard is added and removing it fails the regression.
- [ ] If a guard is added: mutation checkpoint criterion names the enclosing `write-loop.test.ts` test title verbatim and carries a `// @mutate` directive unique to the guard call site (includes an argument token); hand-verified to redden behaviorally (failed assertion, not compile error).
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Gate trust — only if a guard ships; otherwise none.

## Prerequisites

- No-test-impact plan/intent completion diffs resolve to empty `JARVIS_READY_TEST_SCOPE` even when the base ref is unresolvable (landed #2712 / `scripts/ci-test-scope.ts`).
- Fully attributed untouched-path gate failures whose paths reproduce on base ref settle `ready_gate_out_of_scope` without repair (`gate-repair-fence` / `publishWithReadyRepair`).
- Markdown-only plan/intent workflows persist `markdownOutputRoots` on the repair fence and refuse repair commits staging paths outside those roots (`findFirstMarkdownOnlyFenceViolation`).
- `classifyReadyGatePublishFailure` can leave `ready_gate_failed` when base-ref probe errors mark outside paths in-scope (`baseRefProbeError` on `ReadyGateError`).
