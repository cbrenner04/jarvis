# No-test-impact completion ready-gate scope and markdown-only out-of-diff settlement

## Terminology

- **No-test-impact diff** — changed paths where `classifyChangedPaths` returns `[]` (only `NO_TEST_IMPACT_PATTERNS` paths remain after filtering). Today: `v1/spec/**`, `v2/spec/**`, `v1/docs/**`, `v2/docs/**`, `reports/**`; this spec extends the set with `ready-intents/**` (intent durable landing). Plan completion already lands under `v1/spec/**` / `v2/spec/**`.
- **Markdown-only plan/intent completion** — `resolveMarkdownOnlyWorkflowPromptId` is set for the run (plan or intent workflow) and the run diff at completion is confined to that workflow's markdown output roots (plan-tree durable path and/or staging roots; intent `ready-intents/**` and/or `.jarvis-intent-stage/**`). Used only for the out-of-diff settlement guard (problem 2); distinct from no-test-impact scope when docs-only or mixed landing paths differ.

## Problem

Two reachable failure modes strand a fully-drafted markdown-only `plan` or `intent` completion with no PR flip:

1. **Unresolved-base scope fallback:** `resolveCiTestScope(noTestImpactPaths, baseResolvable: false)` returns `full` even though `classifyChangedPaths` already yields `[]` for the same paths when the base ref resolves — completion runs the aggregate suite, flakes under concurrent gate load, and enters repair against unrelated source tests. Intent-only landings under `ready-intents/**` are not no-test-impact on main, so intent completions still run tests even with a resolvable base until classification is extended.
2. **Fence refusal on out-of-diff repair:** when a markdown-only completion's gate failure is fully outside the run diff and bounded repair would stage only non-markdown paths, the attributable write-fence refuses the commit and completion settles `completion_commit_failed` instead of `ready_gate_out_of_scope`.

## Prerequisites

- `classifyChangedPaths` already treats paths under `v1/spec/**`, `v2/spec/**`, `v1/docs/**`, `v2/docs/**`, and `reports/**` as no-test-impact and returns `[]` when no other changed paths remain (resolvable-base plan-tree case covered on main).
- V2 completion derives changed paths from `<baseRef>...HEAD` plus untracked inventory and passes the resolved scope to `bun run ready` via `deriveReadyGateChildEnv` as `JARVIS_READY_TEST_SCOPE` beside `JARVIS_READY_TIER: "full"`.
- `scripts/ready.ts` treats explicit empty `JARVIS_READY_TEST_SCOPE` as skipping all `bun run test*` steps while still running `check`, `typecheck`, and `lint:md`.
- `ready_gate_out_of_scope` already exists for attributed untouched-path gate failures; `publishWithReadyRepair` runs project autofix once per repair entry, then bounded agent repair on `ready_gate_failed`, and refuses repair commits that stage paths outside the frozen repair allowset.

## Decision ledger

- **Scope (problem 1):** Extend `NO_TEST_IMPACT_PATTERNS` with `ready-intents/**` so intent durable landings join plan-tree spec paths as no-test-impact. A no-test-impact diff scopes the ready gate to `check`, `typecheck`, and `lint:md` with no aggregate or scoped `bun run test*` steps — rules out full-suite runs for changes that touch no runtime code. Repo-wide `check` / `typecheck` / `lint:md` remain on empty test scope; unrelated non-test gate failures on no-test-impact diffs are out of scope for problem 1 but may still hit the settlement guard below.
- **Unresolved-base classifier (problem 1):** When `resolveCiTestScope` would return `full` only because `baseResolvable` is false, no-test-impact changed paths still resolve to `[]` (`JARVIS_READY_TEST_SCOPE=""`) — rules out inheriting the implementation-PR unresolved-base `full` fallback on no-test-impact diffs. Code-bearing, empty-path, root-tooling, or unmatched diffs with unresolvable base still fall back to `full`. Changing `resolveCiTestScope` applies to **all** no-test-impact diffs (including docs-only implement runs) as intentional parity with resolvable-base behavior — not an accidental bleed.
- **Settlement defense-in-depth (problem 2):** Markdown-only plan/intent completions that still enter `publishWithReadyRepair` (non-test gate failures, `classifyReadyGatePublishFailure` probe/classification edge cases, or intent paths that still ran tests before problem 1 lands) settle `ready_gate_out_of_scope` without autofix, repair, or fence refusal when the observable predicate stack below holds — rules out stranding correct specs behind `completion_commit_failed` after flaky unrelated source failures. Problem 1 removes the narrated test-failure → repair chain for no-test-impact + unresolvable-base plan/intent completions; problem 2 must stand on its own for remaining reachability.
- **Settlement predicate stack (problem 2):** All must hold: (1) workflow is markdown-only plan or intent (`resolveMarkdownOnlyWorkflowPromptId` set); (2) gate failure failing paths are fully outside the frozen repair allowset derived from the run diff (no mixed in-diff attribution); (3) simulated or actual repair would stage at least one path outside markdown output roots (non-markdown repair shape). When (1–3) hold, settle `ready_gate_out_of_scope` even if `classifyReadyGatePublishFailure` left `ready_gate_failed` (e.g. `baseRefProbeError`). Implement and mixed-diff plan/intent runs keep today's fence and bounded-repair behavior.
- **Settlement ordering (problem 2):** Run the settlement guard in `publishWithReadyRepair` immediately after `classifyReadyGatePublishFailure` and frozen allowset initialization, **before** `runFixCommand` autofix, typecheck verification, `enforceRepairIterationFence`, and `runReadyGateRepairLoop` — not only before the final fence commit check.
- Preserve the attributable write-fence and markdown-only repair roots — rules out weakening fence checks; fix is upstream scope classification and early out-of-scope settlement before repair commits.

## Task checklist

- In `scripts/ci-test-scope.ts`, add `ready-intents/**` to `NO_TEST_IMPACT_PATTERNS`.
- Teach `resolveCiTestScope` to return `[]` when `classifyChangedPaths` returns `[]` and `baseResolvable` is false; keep `full` for unresolvable base with code-bearing, root-tooling, empty, or unmatched paths.
- Rename or narrow `unresolvable base runs full suite regardless of paths` and add sibling `spec-only diff with unresolvable base skips tests` (also cover `ready-intents/**`-only) with `// @mutate` on the new guard.
- In `publishWithReadyRepair` (`v2/src/execution/write-loop.ts`), add an early-settlement helper (e.g. `shouldSettleMarkdownOnlyOutOfScopeRepair`) implementing the predicate stack above; return `ready_gate_out_of_scope` before autofix when it matches.
- Add plan and intent regressions in `v2/src/execution/write-loop.test.ts` for markdown-only completion with an outside-diff source gate failure whose repair would stage the same outside path; pin `// @mutate` on the settlement guard in both tests.
- Add keystone `// @mutate` in the plan pinning test targeting the early-return branch in `publishWithReadyRepair` that emits `ready_gate_out_of_scope` (stable anchor: the guard call or its enclosing `if` — e.g. invert `shouldSettleMarkdownOnlyOutOfScopeRepair(...)` to `false`).
- Update `v2/docs/operator-runbook.md` § Gate trust / Recovery and `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [ ] `scripts/ci-test-scope.test.ts` — test titled `spec-only diff with unresolvable base skips tests` asserts `resolveCiTestScope` on a `v2/spec/**`-only changed set with `baseResolvable: false` resolves to `[]` (no aggregate `bun run test`); fails against pre-fix code where that input returns `full`.
- [ ] `scripts/ci-test-scope.test.ts` — `ready-intents/**`-only changed set with `baseResolvable: true` resolves to `[]` after extending `NO_TEST_IMPACT_PATTERNS`; fails against pre-fix code where intent landings scope tests.
- [ ] Mutation checkpoint: in `scripts/ci-test-scope.test.ts` test `spec-only diff with unresolvable base skips tests`, a `// @mutate` directive inverting the no-test-impact unresolvable-base guard turns that regression RED.
- [ ] `scripts/ci-test-scope.test.ts` test `unresolvable base runs full suite regardless of paths` is renamed or narrowed so it pins code-bearing (or root-tooling / empty / unmatched) + unresolvable base → `full` only; the universal “regardless of paths” claim is removed.
- [ ] `v2/src/execution/write-loop.test.ts` — test titled `spec-only plan completion settles ready_gate_out_of_scope when gate failure is outside the run diff` drives a plan workflow whose run diff is no-test-impact (plan-tree landing only), simulates a ready-gate failure attributed to a source path outside that diff whose repair would stage the same outside path, and asserts settlement is `ready_gate_out_of_scope` with no `ready_gate_repair` or autofix events (not `completion_commit_failed`); fails against pre-fix code that strands on markdown fence refusal (`write-loop.test.ts` test `rejects ready-gate repair staging a source-path edit on plan workflow` is reachable on main for the fenced path but uses a mixed diff).
- [ ] `v2/src/execution/write-loop.test.ts` — test titled `spec-only intent completion settles ready_gate_out_of_scope when gate failure is outside the run diff` mirrors the plan case for intent workflow with `ready-intents/**`-only diff; fails against pre-fix fence refusal.
- [ ] Mutation checkpoint: in `v2/src/execution/write-loop.test.ts` test `spec-only plan completion settles ready_gate_out_of_scope when gate failure is outside the run diff`, a `// @mutate` directive inverting the out-of-diff repair suppression guard turns that regression RED.
- [ ] Mutation checkpoint: in `v2/src/execution/write-loop.test.ts` test `spec-only intent completion settles ready_gate_out_of_scope when gate failure is outside the run diff`, a `// @mutate` directive inverting the same out-of-diff repair suppression guard turns that regression RED.
- [ ] Keystone checkpoint: in `v2/src/execution/write-loop.test.ts` test `spec-only plan completion settles ready_gate_out_of_scope when gate failure is outside the run diff`, a `// @mutate v2/src/execution/write-loop.ts "shouldSettleMarkdownOnlyOutOfScopeRepair(" -> "(() => false)("` directive in that test body turns that regression RED; baseline settles `completion_commit_failed` or enters repair.
- [ ] `write-loop.test.ts` tests `rejects ready-gate repair staging a source-path edit on plan workflow`, `settles ready_gate_out_of_scope without repair while in-scope failures enter bounded repair`, and `ready-finalize.test.ts` test `falls back to JARVIS_READY_TEST_SCOPE=full when diff fails` stay green (implementation-PR and mixed-diff behavior unchanged).
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Gate trust / Recovery — no-test-impact plan/intent completion scopes the ready gate without aggregate or scoped `bun run test*` steps even when the base ref is unresolvable; intent `ready-intents/**` landings are no-test-impact; out-of-diff gate failures on markdown-only plan/intent completions settle `ready_gate_out_of_scope` instead of `completion_commit_failed`.
- `v2/docs/v1-behaviors.md` — plan/intent completion ready-gate test scope for no-test-impact diffs (including `ready-intents/**`) and markdown-only out-of-diff repair settlement.
