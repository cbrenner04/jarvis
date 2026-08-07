# Spec-only completion ready-gate scope and out-of-diff settlement

## Problem

Two reachable failure modes strand a fully-drafted spec-only `plan` or `intent` run with no PR flip:

1. **Unresolved-base scope fallback:** `resolveCiTestScope(specOnlyPaths, baseResolvable: false)` returns `full` even though `classifyChangedPaths` already yields empty test scope for spec-only diffs when the base ref resolves — completion runs the aggregate suite, flakes under concurrent gate load, and enters repair against unrelated source tests.
2. **Fence refusal on out-of-diff repair:** when that repair would stage paths outside the run's diff surface, the attributable write-fence refuses the commit and completion settles `completion_commit_failed` instead of the existing out-of-scope gate settlement path.

## Decision ledger

- Spec-only completion (`classifyChangedPaths` returns `[]` — only `v1/spec/**`, `v2/spec/**`, and/or other `NO_TEST_IMPACT_PATTERNS` paths changed) scopes the ready gate to `check`, `typecheck`, and `lint:md` with no aggregate or scoped `bun run test*` steps — rules out full-suite runs for changes that touch no runtime code.
- When `resolveCiTestScope` would return `full` only because `baseResolvable` is false, spec-only changed paths still resolve to empty test scope (`JARVIS_READY_TEST_SCOPE=""`) — rules out inheriting the implementation-PR unresolved-base `full` fallback on spec-only runs; code-bearing or empty-path diffs with unresolvable base still fall back to `full`.
- Spec-only `plan`/`intent` completion whose ready-gate failure is fully attributed to paths outside the run diff and would enter repair that stages only non-markdown paths settles `ready_gate_out_of_scope` (draft already published; no repair attempt, no fence refusal) — rules out stranding correct specs behind `completion_commit_failed` after flaky unrelated source failures; implement runs and mixed-diff plan/intent runs keep today's fence and bounded-repair behavior.
- Preserve the attributable write-fence and markdown-only repair roots — rules out weakening fence checks; fix is upstream scope classification and early out-of-scope settlement before repair commits.

## Task checklist

- In `scripts/ci-test-scope.ts`, teach `resolveCiTestScope` to return `[]` for no-test-impact-only changed paths when `baseResolvable` is false; keep `full` for unresolvable base with code-bearing, root-tooling, empty, or unmatched paths.
- Add regression `spec-only diff with unresolvable base skips tests` in `scripts/ci-test-scope.test.ts` with a `// @mutate` directive on the new guard.
- In the execution-loop completion publish/repair path (`publishWithReadyRepair` / gate-failure classification in `v2/src/execution/write-loop.ts` and/or `ready-finalize.ts`), detect spec-only plan/intent completion and settle `ready_gate_out_of_scope` when a gate failure is fully attributed outside the run diff and repair would require staging non-markdown paths — before fence enforcement returns `completion_commit_failed`.
- Add paired plan and intent regressions in `v2/src/execution/write-loop.test.ts` for the spec-only-diff flaky-outside-source-failure path with a `// @mutate` directive on the out-of-diff repair suppression guard.
- Add one `Keystone checkpoint:` criterion whose `// @mutate` reverts the spec-only out-of-scope settlement headline.
- Update `v2/docs/operator-runbook.md` § Gate trust / Recovery and `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [ ] `scripts/ci-test-scope.test.ts` — test titled `spec-only diff with unresolvable base skips tests` asserts `resolveCiTestScope` on a `v2/spec/**`-only changed set with `baseResolvable: false` resolves to `[]` (no aggregate `bun run test`); fails against pre-fix code where that input returns `full`.
- [ ] Mutation checkpoint: in `scripts/ci-test-scope.test.ts` test `spec-only diff with unresolvable base skips tests`, a `// @mutate` directive inverting the spec-only unresolvable-base guard turns that regression RED.
- [ ] `v2/src/execution/write-loop.test.ts` — test titled `spec-only plan completion settles ready_gate_out_of_scope when gate failure is outside the run diff` drives a plan workflow whose run diff is spec-only, simulates a ready-gate failure attributed to a source path outside that diff whose repair would stage the same outside path, and asserts settlement is `ready_gate_out_of_scope` with no `ready_gate_repair` event (not `completion_commit_failed`); fails against pre-fix code that strands on markdown fence refusal (`write-loop.test.ts` test `rejects ready-gate repair staging a source-path edit on plan workflow` is reachable on main for the fenced path but uses a mixed diff — this regression is spec-only).
- [ ] `v2/src/execution/write-loop.test.ts` — test titled `spec-only intent completion settles ready_gate_out_of_scope when gate failure is outside the run diff` mirrors the plan case for intent workflow; fails against pre-fix fence refusal.
- [ ] Mutation checkpoint: in `v2/src/execution/write-loop.test.ts` test `spec-only plan completion settles ready_gate_out_of_scope when gate failure is outside the run diff`, a `// @mutate` directive inverting the out-of-diff repair suppression guard turns that regression RED.
- [ ] Keystone checkpoint: in `v2/src/execution/write-loop.test.ts` test `spec-only plan completion settles ready_gate_out_of_scope when gate failure is outside the run diff`, a `// @mutate` directive reverting the spec-only out-of-scope settlement headline turns that regression RED (baseline settles `completion_commit_failed` or enters repair).
- [ ] `write-loop.test.ts` tests `rejects ready-gate repair staging a source-path edit on plan workflow`, `settles ready_gate_out_of_scope without repair while in-scope failures enter bounded repair`, and `ready-finalize.test.ts` test `falls back to JARVIS_READY_TEST_SCOPE=full when diff fails` stay green (implementation-PR and mixed-diff behavior unchanged).
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Gate trust / Recovery — spec-only plan/intent completion scopes the ready gate without aggregate or scoped `bun run test*` steps even when the base ref is unresolvable; out-of-diff gate failures on spec-only runs settle `ready_gate_out_of_scope` instead of `completion_commit_failed`.
- `v2/docs/v1-behaviors.md` — plan/intent completion ready-gate test scope for spec-only diffs and out-of-diff repair settlement for spec-only diffs.
