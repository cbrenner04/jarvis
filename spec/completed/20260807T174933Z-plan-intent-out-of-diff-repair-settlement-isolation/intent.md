---
name: plan-intent-out-of-diff-repair-settlement-isolation
---

# Markdown-only out-of-diff repair settlement: prove redundancy or isolate guard

Single execution-loop surface (`publishWithReadyRepair` settlement and pinning regressions in `write-loop.test.ts`); splitting by module boundary does not apply.

## Problem

The #2712 settlement half proposed `shouldSettleMarkdownOnlyOutOfScopeRepair` in `publishWithReadyRepair` to settle `ready_gate_out_of_scope` instead of `completion_commit_failed` when a markdown-only plan/intent completion's gate failure is fully outside the run diff and repair would stage only non-markdown paths. It was dropped: disabling the guard left drafted settlement regressions green (attributable untouched-path settlement already returns `ready_gate_out_of_scope`), and mutation checkpoints were hollow or false-reddened via compile error (directive matched both function definition and call site).

## Decisions

- Add isolation regressions for markdown-only plan and intent completions using outside-diff gate failures on a `ready_gate_failed`-leaving seam (`baseRefProbeFailsSeam` or equivalent so `classifyReadyGatePublishFailure` leaves `ready_gate_failed` before repair, not markdown-fence `completion_commit_failed`) before adding any new settlement guard — rules out re-landing hollow dead code from #2712.
- If those regressions already settle `ready_gate_out_of_scope` via existing attributable untouched-path settlement, omit `shouldSettleMarkdownOnlyOutOfScopeRepair`, record redundancy in the subspec, and treat the branch as characterization/preservation (new pins lock existing behavior; not a failing-test-first behavior change) — rules out a second settlement path that duplicates observable behavior.
- If the regressions strand on `completion_commit_failed`, add the guard, pin it with a call-site-unique `// @mutate` that includes an argument token and does not match the function definition, and add a `Keystone checkpoint:` criterion whose `// @mutate` reverts the headline settlement change — rules out compile-error false-redden and inert headline changes.
- One plan-regression guard `Mutation checkpoint:` suffices for shared `publishWithReadyRepair` settlement logic; the intent regression asserts settlement parity but does not need a second `@mutate` pin.

## Acceptance criteria

- [ ] `write-loop.test.ts` — regression(s) titled for markdown-only plan and intent completions use markdown-only fixtures, an outside-diff gate failure on `baseRefProbeFailsSeam` (or equivalent `ready_gate_failed`-leaving seam), and assert the current (pre-guard) settlement outcome; if already `ready_gate_out_of_scope`, the subspec documents redundancy and no guard is added; if it strands on `completion_commit_failed`, the guard is added and removing it fails the regression.
- [ ] If a guard is added: `Mutation checkpoint:` criterion names the plan regression's enclosing `write-loop.test.ts` test title verbatim and carries a `// @mutate` directive unique to the guard call site (includes an argument token) that reddens via failed assertion, not compile error.
- [ ] If a guard is added: `Keystone checkpoint:` criterion names the same plan regression test title and carries a `// @mutate` that reverts the headline settlement change (`ready_gate_out_of_scope` → `completion_commit_failed`).
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Gate trust and `v2/docs/v1-behaviors.md` — only if a guard ships; otherwise none.

## Prerequisites

- No-test-impact plan/intent completion diffs resolve to empty `JARVIS_READY_TEST_SCOPE` even when the base ref is unresolvable (landed #2712 / `scripts/ci-test-scope.ts`).
- Fully attributed untouched-path gate failures whose paths reproduce on base ref settle `ready_gate_out_of_scope` without repair (`gate-repair-fence` / `publishWithReadyRepair`).
- Markdown-only plan/intent workflows persist `markdownOutputRoots` on the repair fence and refuse repair commits staging paths outside those roots (`findFirstMarkdownOnlyFenceViolation`).
- `classifyReadyGatePublishFailure` can leave `ready_gate_failed` when base-ref probe errors mark outside paths in-scope (`baseRefProbeError` on `ReadyGateError`).
