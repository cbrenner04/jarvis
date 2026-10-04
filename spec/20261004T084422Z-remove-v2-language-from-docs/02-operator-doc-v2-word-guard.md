# 02 — Operator-doc `v2` word guard

## Problem

Without automation, live-engine `v2` prose can return after the editorial sweep; intent acceptance requires a structural guard that fails on today's corpus.

## Decisions

- Add `scripts/guard-operator-doc-v2-language.ts` plus `scripts/guard-operator-doc-v2-language.test.ts` — rules out relying on ad-hoc `grep` in acceptance criteria only.
- Scan the same corpus as intent: all files under `docs/`, plus repo-root `AGENTS.md` and `README.md`; respect `.markdownlint-cli2.jsonc` ignore globs (`**/completed/**`, `**/verdict-*.md`) — rules out scanning `v1/**` or `spec/**` in this guard.
- For each physical line containing `\bv2\b`, allow only when the line matches a retired-generation-history predicate (frozen `v1/` contrast, former `v2/` directory layout, `jarvis` vs `jarvis1` coexistence, or explicit move-v2-to-top-level narrative) encoded in the guard module — rules out a blanket ban with no allowance for historical sentences subspec 01 may keep.
- Register the guard in `package.json` `check` after existing guard scripts — rules out a test-only check agents can skip during iteration.
- Subspec 01 lands before this subspec so the guard's positive fixtures reflect the post-sweep corpus — rules out implementing the guard on stale prose that subspec 01 will delete anyway.

## Tasks

- [ ] Implement the guard and unit tests (synthetic violation fixture proves the matcher fires).
- [ ] Wire `bun run scripts/guard-operator-doc-v2-language.ts` into `bun run check`.
- [ ] Document the guard in `docs/coding-standards.md` § Export hygiene gate (or adjacent guard inventory) with one line on allowed retired-generation history.

## Acceptance criteria

- [x] `scripts/guard-operator-doc-v2-language.test.ts` fails against the pre-fix operator corpus (e.g. `docs/operator-runbook.md` title line with `\bv2\b`, constructible on main) and passes after subspecs 00–01.
- [x] `bun run check` runs the new guard; fails against pre-fix tree when the guard is wired but prose is unchanged.
- [x] `bun run typecheck` passes.

## Documentation updates

- `docs/coding-standards.md` (guard inventory line)
- `package.json` (`check` script)
