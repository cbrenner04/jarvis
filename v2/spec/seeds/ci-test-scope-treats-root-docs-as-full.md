---
name: ci-test-scope-treats-root-docs-as-full
---

# CI test-scope classifier runs the full aggregate for a root-doc edit

## Problem

`scripts/ci-test-scope.ts` `classifyChangedPaths` falls to `return "full"` for any changed path that is neither a recognized source surface (`v2/`, `shared/`, `test/`) nor listed in `NO_TEST_IMPACT_PATTERNS` (`ready-intents/`, `reports/`, `v1/`, `v2/docs/`, `v2/spec/`). Root-level docs — `AGENTS.md`, `README.md`, `CLAUDE.md`, `LICENSE` — match nothing, so editing one forces the entire aggregate suite. A PR mixing a root-doc edit with scoped source (e.g. `v2/**`) is dragged to `full` instead of scoping to the source surface.

The full aggregate is the whole suite rather than the touched surface, so a v2 feature PR pays the entire wall clock — and any load-sensitive test anywhere in the corpus can red-gate it — purely because it touched a top-level doc.

## Evidence

PR #3295 (v2 notification feature + `AGENTS.md`/`README.md` one-liners): `bun run scripts/ci-test-scope.ts` on its diff returns `full` while every path that could affect the result is `v2/**`. Recurs on every root-doc-touching PR.

## Decisions

- Root-level documentation is no-test-impact: filter it out like the other `NO_TEST_IMPACT_PATTERNS` so remaining scoped paths determine scope (a root-doc-only diff → empty scope; root-doc + `v2/**` → `test:v2 test:integration:v2`).
- Scope root docs conservatively: top-level `*.md` and `LICENSE` only. Keep `ROOT_TOOLING_PATTERNS` (`package.json`, `tsconfig*`, `.github/`, `scripts/`) → `full`, and keep any *other* unrecognized root path (e.g. `Makefile`, a new root config) → `full` — do not blanket-whitelist the repo root.
- Docs-part covers the classifier's stated contract wherever it is described (`AGENTS.md` test-scope rule, the `v2/docs` operator-runbook gate section).

## Acceptance criteria

- [ ] `classifyChangedPaths(["README.md"])` and `["AGENTS.md"]` and `["CLAUDE.md"]` and `["LICENSE"]` each return `[]` (no tests) — pinned in `scripts/ci-test-scope.test.ts`.
- [ ] `classifyChangedPaths(["AGENTS.md", "v2/src/x.ts"])` returns `["test:v2", "test:integration:v2"]` — root doc filtered, source surface determines scope.
- [ ] `classifyChangedPaths(["package.json"])` and `["Makefile"]` still return `"full"` — tooling and unknown non-doc root paths unchanged.
- [ ] `bun run typecheck` and the `test:shared` pair (root `test/**` + `scripts/**` surface) pass.

## Documentation updates

- `AGENTS.md` — the test-scope working rule: note root docs (`*.md`, `LICENSE`) classify as no-test, like `v2/docs`/specs.
- `v2/docs/operator-runbook.md` — the ready/CI gate scope description, same clarification.
