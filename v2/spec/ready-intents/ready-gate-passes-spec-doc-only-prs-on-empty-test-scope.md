---
name: ready-gate-passes-spec-doc-only-prs-on-empty-test-scope
---
# Ready gate passes spec/doc-only PRs instead of failing on empty test scope

## Problem

`jarvis1 triage <plan-pr> --merge` on a markdown-only plan PR (changes only under
`v2/spec/**`, `v1/spec/**`, docs, reports) fails its local ready gate with
`ready: resolved test scope contains no test steps`. The gate (`scripts/ready.ts`)
treats an empty resolved test scope as a hard failure — correct for an
implementation PR (code with no tests is a red flag), wrong for a PR that
legitimately changes no code. So the gated merge path is unavailable for the exact
PR class it should breeze through, and every plan PR falls back to hand
`gh pr merge --admin`.

Observed 2026-07-17 on #1691. Counterpart to #1684 (which made `triage --merge`
*resolve* v2 plan specs so the command reaches the gate); this removes the next wall.

## Decisions

- A diff with no changed path under a test-bearing surface passes the ready gate rather than failing on empty test scope; rules out treating "no tests to run" as "tests failed" for a code-free PR.
- Key the pass-through on the same no-test-impact classification `ci-test-scope.ts` already uses (docs/spec/reports diff → no test steps); rules out inventing a second, divergent notion of "docs-only" in the ready gate.
- Keep failing empty scope when the diff *does* touch code; rules out weakening the guard for implementation PRs where empty scope is a real defect.
- `lint:md`/`check` still run on the passing spec/doc-only PR; rules out skipping the gate entirely — the markdown linters are the relevant gate for a docs/spec PR.

## Notes

`ci-test-scope.ts` distinguishes an empty scope produced by a no-test-impact diff
(the `filtered.length === 0` branch) from `"full"`/failure. The ready gate must mirror
that: empty-because-no-code passes; empty-because-something-else keeps its meaning.

Cleanup: the v2 operator runbook and v1 runbook both tell operators to prefer
`triage --merge` for plan PRs — update them to reflect that the path now works for
spec/doc-only PRs (drop any note steering to hand `--admin` for this case).

## Prerequisites

- triage --merge resolves v2 plan specs and reaches the ready gate on a spec-only plan PR
