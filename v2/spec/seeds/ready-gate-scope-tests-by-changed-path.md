---
name: ready-gate-scope-tests-by-changed-path
---

# Ready gate should scope tests by changed path like CI, not always run the full suite

`bun run ready` (`scripts/ready.ts`) runs `bun run test` — the **full** suite
(`scripts/run-tests.ts`: v1 + v2 + shared, agent + integration) on every gate, regardless of
what the diff touched. CI does not: the `checks` job uses `scripts/ci-test-scope.ts`
(`classifyChangedPaths`) to run only the affected suites (`v1/**`→`test:v1`, `v2/**`→
`test:v2`+`test:integration:v2`, `shared/**`/root-tooling/unresolved→full). The result is that a
v1-only or v2-only implementation's completion/review ready gates run suites CI skips — observed
this session: v1-only impls (#1184, #1185) ran `test:v2`+`integration:v2` locally for nothing,
and each `jarvis run` executes the gate multiple times (completion + review baseline + review
final), so the waste multiplies. Impl runs landed at 27–60 min, over half of it repeated
full-suite gate execution.

## Decisions

- Ready-gate test execution reuses the **same** `classifyChangedPaths` classifier CI uses
  (`scripts/ci-test-scope.ts`) against the run's base branch, running only the scoped suites —
  never a subset smaller than CI would run for the same diff. The classifier already returns
  `full` for `shared/**`, root-tooling, and unresolved-base diffs, so those stay full (safe).
- Applies to every gate site that runs `bun run test` today (completion transition, review
  baseline, review final, pre-shrink, `maybeMarkReady`, triage). The gate must diff against the
  correct base to detect changed paths; fall back to `full` when the base can't be resolved.
- Keep the full-suite path as the fallback and as the `main`-push behavior; this only narrows
  the per-run gate to match CI, it does not weaken the merge contract.
- `lint:md` and `typecheck` are unaffected (already cheap / always run).

## Out of scope

- Changing CI's own scoping (already correct).
- `shared/**` diffs — they legitimately run full (shared feeds both v1 and v2 callers), so this
  does not speed up shared-touching work like the seed 08 slices.
- Reducing review-pass count (a separate speed lever).

## Documentation updates

- `v1/docs/operator-runbook.md` § The gate: note the ready gate now scopes tests by changed path
  matching CI, so a v1-only/v2-only impl no longer runs the other surface's suites locally.
- `v2/docs/v1-behaviors.md`: record the ready gate's path-scoped test selection.
