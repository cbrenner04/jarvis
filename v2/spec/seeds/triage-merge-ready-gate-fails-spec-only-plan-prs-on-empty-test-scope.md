# `triage --merge` fails spec-only plan PRs on empty test scope

## Problem

`jarvis1 triage <plan-pr> --merge` on a markdown-only plan PR fails its local ready gate with:

```
triage --merge (plan PR): ready gate failed
bun run ready failed:
ready: resolved test scope contains no test steps
```

Observed 2026-07-17 on #1691 (a plan PR touching only `v2/spec/**`). The gate treats an **empty
resolved test scope as a failure** — correct for an implementation PR (code with no tests is a
red flag), wrong for a plan/seed/doc PR that legitimately changes no code and runs no tests. So the
gated merge path is unavailable for exactly the PR class it should breeze through, and every plan PR
falls back to hand `gh pr merge --admin`.

This is the good-news counterpart to #1684: that fix made `triage --merge` *resolve* v2 plan specs
(no more `no spec found`), so the command now reaches the gate — and the gate is the next wall. The
two together are what it takes for plan PRs to merge through the gated path.

## Decisions

- A spec/doc-only PR (no changed path under a test-bearing surface) passes the ready gate rather than
  failing on empty test scope; rules out treating "no tests to run" as "tests failed" for a PR that
  changes no code.
- `lint:md`/`check` still run on such a PR; rules out skipping the gate entirely — the markdown
  linters are the relevant gate for a docs/spec PR.
- Scope the relaxation to the no-code-change case, keyed the same way `ci-test-scope.ts` already
  decides a docs-only diff runs no test steps; rules out weakening the empty-scope guard for PRs that
  *do* touch code (where an empty scope is a real defect).

## Notes

`ci-test-scope.ts` already encodes "a diff touching only `v1/spec/**`, `v2/spec/**`, docs, reports
skips tests entirely." The ready gate's empty-scope-fails rule contradicts that policy for the
local/triage path. Align them: the gate should mirror the CI scoping decision, not fail where CI
would skip.

Cleanup: the v2 operator runbook and v1 runbook both tell operators to prefer `triage --merge` for
plan PRs; note this gap there until it ships.
