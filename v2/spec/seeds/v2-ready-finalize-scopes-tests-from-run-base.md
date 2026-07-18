---
name: v2-ready-finalize-scopes-tests-from-run-base
---

# v2 ready-finalize scopes tests from the run base

## Problem

`v2/src/execution/ready-finalize.ts` (`createDefaultRunReadyGate`) hardcodes
`JARVIS_READY_TIER: "full"` and never computes or passes `JARVIS_READY_TEST_SCOPE`.
Every v2 implement completion runs the full aggregate suite regardless of the diff,
even though the scoping mechanism already exists and is already wired for v1.

`scripts/ci-test-scope.ts` exports pure `classifyChangedPaths`/`resolveCiTestScope`
functions. `v1/src/ready-gate.ts:361-362` already computes changed paths against the
run base and passes `JARVIS_READY_TEST_SCOPE`; `scripts/ready.ts` already parses it.
v2 has no equivalent wiring.

This is a blocking prerequisite for ready-intent
`implement-completion-requires-diff-derived-mutation-evidence`, which assumes v2
completion's ready gate is already base-scoped (discovered live: `jarvis run workflow
plan` blocked on this unmet prerequisite, 2026-07-18).

## Decisions

- Add `baseRef` to `ReadyFinalizeInput` and thread it from the run's known base branch;
  rules out re-deriving the base from git config or assuming `main`.
- Reuse `classifyChangedPaths`/`resolveCiTestScope` from `scripts/ci-test-scope.ts`
  unmodified; rules out a parallel v2-only scoping implementation.
- Compute changed paths via `git diff --name-only <baseRef>...HEAD` in the worktree;
  rules out relying on caller-supplied diff state.
- Pass `JARVIS_READY_TEST_SCOPE` alongside `JARVIS_READY_TIER: "full"` (tier stays
  full; only the test-step scope narrows) — matches v1's existing split; rules out
  changing tier semantics as part of this fix.
- An unresolvable base (git diff fails) falls back to `"full"` scope, matching
  `resolveCiTestScope`'s existing `baseResolvable` contract; rules out a hard failure
  on an edge case the function already handles.

## Out of scope

- Changing `JARVIS_READY_TIER` behavior or the `full`-tier-always-runs decision.
- Any v1 `ready-gate.ts` changes (already wired).

## Documentation updates

- `v2/docs/write-behavior.md` — record the base-scoped test-step behavior.
- `v2/docs/operator-runbook.md` § Gate trust — note the scoping, since prior text
  said the v2 gate runs the full tier "unconditionally."
- `v2/docs/v1-behaviors.md` — align v1/v2 ready-gate scoping behavior.
