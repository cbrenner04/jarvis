---
name: ready-gate-scope-tests-by-changed-path
---
# Ready Gate Scope Tests By Changed Path

# Ready gate scopes tests by changed path like CI

`bun run ready` always runs the full test suite regardless of diff. CI's `checks` job
scopes suites via `classifyChangedPaths` (`scripts/ci-test-scope.ts`). The ready gate
should reuse the same classifier against the run's base branch so it never runs a
broader (or narrower) set of suites than CI would for the same diff, falling back to
full when the base can't be resolved. This applies at every existing gate call site
(completion transition, review baseline, review final, pre-shrink, `maybeMarkReady`,
triage) — each already resolves or can resolve its base ref. `shared/**`, root-tooling,
and unresolved-base diffs keep running full (`classifyChangedPaths` already returns
`full` for these). CI's own scoping and review-pass count are unchanged.

## Prerequisites

- `scripts/ci-test-scope.ts` exposes `classifyChangedPaths`, used by CI's `checks` job to scope suites by changed path.
- The ready gate runs through `runReadyGateWithTier`/`runReadyAndCommit` (`v1/src/ready-gate.ts`) at every gate call site, invoking `scripts/ready.ts` via `bun run ready`.
