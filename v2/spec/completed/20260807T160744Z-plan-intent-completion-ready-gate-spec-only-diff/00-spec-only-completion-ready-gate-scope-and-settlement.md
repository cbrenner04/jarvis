# No-test-impact completion ready-gate scope on unresolvable base

## Terminology

- **No-test-impact diff** — changed paths where `classifyChangedPaths` returns `[]` (only `NO_TEST_IMPACT_PATTERNS` paths remain after filtering). Today: `v1/spec/**`, `v2/spec/**`, `v1/docs/**`, `v2/docs/**`, `reports/**`; this spec extends the set with `ready-intents/**` (intent durable landing). Plan completion already lands under `v1/spec/**` / `v2/spec/**`.

## Problem

A `plan` or `intent` completion whose diff is no-test-impact still runs the aggregate suite when the base ref is unresolvable: `resolveCiTestScope(noTestImpactPaths, baseResolvable: false)` returns `full` even though `classifyChangedPaths` already yields `[]` for the same paths when the base ref resolves. That flakes under concurrent gate load and enters repair against unrelated source tests, stranding a fully-drafted markdown-only completion. Intent-only landings under `ready-intents/**` are additionally not no-test-impact on main, so intent completions run tests even with a resolvable base until classification is extended.

The related out-of-diff repair-fence settlement (`ready_gate_out_of_scope` instead of `completion_commit_failed`) is **out of scope here** — the guard proved redundant with the existing attributable-untouched-path settlement and its checkpoints hollow; re-scoped to seed `plan-intent-completion-out-of-diff-repair-settlement-is-redundant-or-needs-isolation`.

## Prerequisites

- `classifyChangedPaths` already treats paths under `v1/spec/**`, `v2/spec/**`, `v1/docs/**`, `v2/docs/**`, and `reports/**` as no-test-impact and returns `[]` when no other changed paths remain (resolvable-base plan-tree case covered on main).
- V2 completion derives changed paths from `<baseRef>...HEAD` plus untracked inventory and passes the resolved scope to `bun run ready` via `deriveReadyGateChildEnv` as `JARVIS_READY_TEST_SCOPE` beside `JARVIS_READY_TIER: "full"`.
- `scripts/ready.ts` treats explicit empty `JARVIS_READY_TEST_SCOPE` as skipping all `bun run test*` steps while still running `check`, `typecheck`, and `lint:md`.

## Decision ledger

- Extend `NO_TEST_IMPACT_PATTERNS` with `ready-intents/**` so intent durable landings join plan-tree spec paths as no-test-impact. A no-test-impact diff scopes the ready gate to `check`, `typecheck`, and `lint:md` with no aggregate or scoped `bun run test*` steps — rules out full-suite runs for changes that touch no runtime code.
- When `resolveCiTestScope` would return `full` only because `baseResolvable` is false, no-test-impact changed paths still resolve to `[]` (`JARVIS_READY_TEST_SCOPE=""`) — rules out inheriting the implementation-PR unresolved-base `full` fallback on no-test-impact diffs. Code-bearing, empty-path, root-tooling, or unmatched diffs with unresolvable base still fall back to `full`. This applies to **all** no-test-impact diffs (including docs-only implement runs) as intentional parity with resolvable-base behavior.

## Task checklist

- In `scripts/ci-test-scope.ts`, add `ready-intents/**` to `NO_TEST_IMPACT_PATTERNS`.
- Teach `resolveCiTestScope` to return `[]` when `classifyChangedPaths` returns `[]` and `baseResolvable` is false; keep `full` for unresolvable base with code-bearing, root-tooling, empty, or unmatched paths.
- Rename or narrow `unresolvable base runs full suite regardless of paths` and add sibling `spec-only diff with unresolvable base skips tests` (also cover `ready-intents/**`-only) with `// @mutate` on the new guard.
- Update `v2/docs/operator-runbook.md` § Gate trust and `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [x] `scripts/ci-test-scope.test.ts` — test titled `spec-only diff with unresolvable base skips tests` asserts `resolveCiTestScope` on a `v2/spec/**`-only changed set with `baseResolvable: false` resolves to `[]` (no aggregate `bun run test`); fails against pre-fix code where that input returns `full`.
- [x] `scripts/ci-test-scope.test.ts` — `ready-intents/**`-only changed set with `baseResolvable: true` resolves to `[]` after extending `NO_TEST_IMPACT_PATTERNS`; fails against pre-fix code where intent landings scope tests.
- [x] Mutation checkpoint: in `scripts/ci-test-scope.test.ts` test `spec-only diff with unresolvable base skips tests`, a `// @mutate` directive inverting the no-test-impact unresolvable-base guard turns that regression RED.
- [x] `scripts/ci-test-scope.test.ts` test `unresolvable base runs full suite regardless of paths` is renamed or narrowed so it pins code-bearing (or root-tooling / empty / unmatched) + unresolvable base → `full` only; the universal "regardless of paths" claim is removed.
- [x] `ready-finalize.test.ts` test `falls back to JARVIS_READY_TEST_SCOPE=full when diff fails` stays green (implementation-PR behavior unchanged).
- [x] `bun run typecheck` and `bun run check` pass; the `scripts/ci-test-scope.test.ts` suite passes.

## Documentation updates

- `v2/docs/operator-runbook.md` § Gate trust — no-test-impact plan/intent completion scopes the ready gate without aggregate or scoped `bun run test*` steps even when the base ref is unresolvable; intent `ready-intents/**` landings are no-test-impact.
- `v2/docs/v1-behaviors.md` — plan/intent completion ready-gate test scope for no-test-impact diffs (including `ready-intents/**`).
