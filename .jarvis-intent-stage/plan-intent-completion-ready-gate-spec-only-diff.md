---
name: plan-intent-completion-ready-gate-spec-only-diff
---

# Plan/intent completion ready-gate scopes spec-only diffs and does not strand on out-of-diff repair

The fix touches one module-boundary surface (execution loop): ready-gate scope derivation, completion publish/repair, and the shared classifier hook in `scripts/ci-test-scope.ts` — splitting does not apply.

## Problem

A `plan` or `intent` run whose diff is Markdown-only under `v2/spec/**` (or `v1/spec/**`) can still run the aggregate test suite at completion, flake under concurrent gate load, enter ready-gate repair against unrelated source tests, and settle `completion_commit_failed` when the attributable write-fence refuses out-of-diff repair edits — stranding a fully-drafted spec with no PR flip.

## Decisions

- Spec-only completion (only `v1/spec/**` / `v2/spec/**` Markdown changed) scopes the ready gate to `check`, `typecheck`, and `lint:md` with no aggregate or scoped `bun run test*` steps — rules out full-suite runs for changes that touch no runtime code.
- When `resolveCiTestScope` would return `full` only because the base ref is unresolvable, spec-only plan/intent completion still resolves to empty test scope — rules out inheriting the implementation-PR unresolved-base fallback on spec-only runs.
- Spec-only completion whose ready-gate repair would stage a path outside the run's diff surface publishes the clean draft (or settles a distinct non-stranding outcome) instead of `completion_commit_failed` — rules out stranding correct specs behind fence refusal after flaky unrelated source failures.
- Preserve the attributable write-fence — rules out weakening fence checks; fix is upstream scope classification and repair suppression.

## Acceptance criteria

- [ ] `scripts/ci-test-scope.test.ts` drives a `v2/spec/**`-only changed-set and asserts the resolved scope excludes aggregate `bun run test`; fails against pre-fix classification that yields `full` or non-empty test scripts for that set.
- [ ] `write-loop.test.ts` regression covers the spec-only-diff-with-flaky-source-failure path: a plan/intent completion whose gate failure would repair only by editing source outside the run diff publishes the clean draft or settles a distinct non-stranding outcome instead of `completion_commit_failed`; fails against pre-fix code that strands on fence refusal.
- [ ] Mutation checkpoint: in the `scripts/ci-test-scope.test.ts` pinning test named above, a `// @mutate` directive inverting the spec-only-scope classification turns that regression RED.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Gate trust / Recovery — spec-only plan/intent completion no longer runs the full suite; if one strands on flaky unrelated source tests, hand-publish the clean draft.

## Prerequisites

- `classifyChangedPaths` / `resolveCiTestScope` treat paths under `v1/spec/**`, `v2/spec/**`, `v1/docs/**`, `v2/docs/**`, and `reports/**` as no-test-impact and return empty test scope when no other changed paths remain.
- V2 completion derives changed paths from `<baseRef>...HEAD` plus untracked inventory and passes the resolved scope to `bun run ready` as `JARVIS_READY_TEST_SCOPE` beside `JARVIS_READY_TIER: "full"`.
- `scripts/ready.ts` treats explicit empty `JARVIS_READY_TEST_SCOPE` as skipping all `bun run test*` steps while still running `check`, `typecheck`, and `lint:md`.
- `publishWithReadyRepair` runs project autofix once per repair entry, then bounded agent repair on `ready_gate_failed`, and refuses repair commits that stage paths outside the frozen repair allowset.
