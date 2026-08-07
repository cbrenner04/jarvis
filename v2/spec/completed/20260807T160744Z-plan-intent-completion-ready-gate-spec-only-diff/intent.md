---
name: plan-intent-completion-ready-gate-spec-only-diff
---

# Plan/intent completion ready-gate scopes spec-only diffs and does not strand on out-of-diff repair

The fix touches one module-boundary surface (execution loop): ready-gate scope derivation, completion publish/repair, and the shared classifier hook in `scripts/ci-test-scope.ts` — splitting does not apply.

## Problem

Two reachable failure modes strand a fully-drafted spec-only `plan` or `intent` run with no PR flip:

1. **Unresolved-base scope fallback:** `resolveCiTestScope(specOnlyPaths, baseResolvable: false)` returns `full` today even though `classifyChangedPaths` already yields empty test scope for spec-only diffs when the base ref resolves — so completion still runs the aggregate suite, can flake under concurrent gate load, and enters repair against unrelated source tests.
2. **Fence refusal on out-of-diff repair:** when that repair would stage paths outside the run's diff surface, the attributable write-fence refuses the commit and completion settles `completion_commit_failed` instead of the existing out-of-scope gate settlement path.

## Decisions

- Spec-only completion (only `v1/spec/**` / `v2/spec/**` Markdown changed) scopes the ready gate to `check`, `typecheck`, and `lint:md` with no aggregate or scoped `bun run test*` steps — rules out full-suite runs for changes that touch no runtime code.
- When `resolveCiTestScope` would return `full` only because the base ref is unresolvable, spec-only plan/intent completion still resolves to empty test scope — rules out inheriting the implementation-PR unresolved-base fallback on spec-only runs.
- Spec-only plan/intent completion whose ready-gate repair would stage a path outside the run's diff surface settles `ready_gate_out_of_scope` (draft already published; no repair attempt) instead of entering fence refusal → `completion_commit_failed` — rules out stranding correct specs behind fence refusal after flaky unrelated source failures.
- Preserve the attributable write-fence — rules out weakening fence checks; fix is upstream scope classification and early out-of-scope settlement before repair commits.

## Acceptance criteria

- [ ] `scripts/ci-test-scope.test.ts` adds a regression for a `v2/spec/**`-only changed set with `baseResolvable: false` and asserts resolved scope excludes aggregate `bun run test`; fails against pre-fix code where that input returns `full`.
- [ ] `write-loop.test.ts` regression covers the spec-only-diff-with-flaky-source-failure path: a plan/intent completion whose gate failure would repair only by editing source outside the run diff settles `ready_gate_out_of_scope` instead of `completion_commit_failed`; fails against pre-fix code that strands on fence refusal.
- [ ] Mutation checkpoint: in `scripts/ci-test-scope.test.ts` test `spec-only diff with unresolvable base skips tests`, a `// @mutate` directive inverting the spec-only unresolvable-base guard turns that regression RED.
- [ ] Mutation checkpoint: in `write-loop.test.ts` test covering the spec-only-diff-with-flaky-source-failure path named above, a `// @mutate` directive inverting the out-of-diff repair suppression guard turns that regression RED.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Gate trust / Recovery — spec-only plan/intent completion no longer runs the full suite; out-of-diff gate failures on spec-only runs settle `ready_gate_out_of_scope` instead of `completion_commit_failed`.
- `v2/docs/v1-behaviors.md` — plan/intent completion ready-gate test scope and out-of-diff repair settlement for spec-only diffs.

## Prerequisites

- `classifyChangedPaths` already treats paths under `v1/spec/**`, `v2/spec/**`, `v1/docs/**`, `v2/docs/**`, and `reports/**` as no-test-impact and returns empty test scope when no other changed paths remain (resolvable-base spec-only case covered on main).
- V2 completion derives changed paths from `<baseRef>...HEAD` plus untracked inventory and passes the resolved scope to `bun run ready` as `JARVIS_READY_TEST_SCOPE` beside `JARVIS_READY_TIER: "full"`.
- `scripts/ready.ts` treats explicit empty `JARVIS_READY_TEST_SCOPE` as skipping all `bun run test*` steps while still running `check`, `typecheck`, and `lint:md`.
- `ready_gate_out_of_scope` already exists for attributed untouched-path gate failures; `publishWithReadyRepair` runs project autofix once per repair entry, then bounded agent repair on `ready_gate_failed`, and refuses repair commits that stage paths outside the frozen repair allowset.
