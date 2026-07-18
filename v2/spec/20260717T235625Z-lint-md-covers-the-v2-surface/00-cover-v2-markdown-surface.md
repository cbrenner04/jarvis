# Widen `lint:md` globs to the v2 surface and fix violations

`lint:md` lints `v2/docs/onboarding.md` only. The full-tier ready gate therefore
misses v2 spec trees, seeds, ready-intents, and the rest of `v2/docs/` — a blind
spot that lets lint-dirty v2 markdown merge and redden every subsequent run's
completion gate.

## Decisions

- Replace `v2/docs/onboarding.md` with `v2/docs/**/*.md` and `v2/spec/**/*.md` in `.markdownlint-cli2.jsonc` `globs`; rules out keeping single-file coverage or a separate v2-only config file.
- Keep existing `**/completed/**` and `**/verdict-*.md` ignores unchanged; rules out linting archived completed trees or verdict artifacts.
- Reuse the shared house-style `config` block as-is — no v2-only rule relaxations; rules out a second markdownlint config or per-surface overrides.
- Fix every violation surfaced by the widened globs in the same change; rules out landing a red `lint:md` gate that blocks all later runs.
- Add `scripts/markdownlint-globs.test.ts` to pin the glob contract; rules out config-only changes with no regression guard.

## Task checklist

- [ ] Update `.markdownlint-cli2.jsonc` globs.
- [ ] Fix all markdownlint violations under the newly covered v2 paths.
- [ ] Add `scripts/markdownlint-globs.test.ts`.
- [ ] Update operator runbooks and README lint coverage prose.

## Acceptance criteria

- [x] `bun run lint:md` exits 0 on the committed tree with the widened globs.
- [x] `scripts/markdownlint-globs.test.ts` asserts `.markdownlint-cli2.jsonc` lists `v2/docs/**/*.md` and `v2/spec/**/*.md`, does not list `v2/docs/onboarding.md`, and keeps the `**/completed/**` and `**/verdict-*.md` ignores; it fails against the pre-fix config.
- [x] `v1/docs/operator-runbook.md` § The gate no longer claims `lint:md` excludes `v2/docs/**`; the `lint:md` glob enumeration includes `v2/docs/**` and `v2/spec/**`.
- [x] `v2/docs/operator-runbook.md` § Gate trust states the full-tier gate's `lint:md` step covers v2 markdown (`v2/docs/**`, `v2/spec/**`, subject to the shared ignores); the `lint:md` lints one file in all of v2 gotcha is removed.

## Documentation updates

- `v1/docs/operator-runbook.md` § The gate — drop the `**not** v2/docs/**` caveat; enumerate `v2/docs/**` and `v2/spec/**` among linted surfaces.
- `v2/docs/operator-runbook.md` § Gate trust — state full-tier `lint:md` covers v2 markdown; delete the `lint:md` lints one file in all of v2 gotcha (lines ~571–574).
- `README.md` § Development — the `lint:md` blurb reflects v2 `docs/` and `spec/` coverage alongside v1 surfaces.
- No `v2/docs/v1-behaviors.md` change: harness lint scope only; no v1 product behavior changes.
