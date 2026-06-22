# Disable noNonNullAssertion autofix in the ready gate

## Problem

`bun run ready` runs `check:fix:unsafe` (`biome check --write --unsafe .`,
`scripts/ready.ts:206`) just before its `typecheck` step. `biome.json` enables
the `recommended` rule set, so biome auto-applies the `noNonNullAssertion`
unsafe fix: `match[1]!.trim()` → `match[1]?.trim()`. Under
`noUncheckedIndexedAccess` the rewritten `?.` is `T | undefined`; a downstream
assignment to a non-`undefined` type then fails typecheck (TS2322). The gate
mutates type-correct code into a type error and fails its own typecheck step,
leaving the spec unfinalizable while CI stays green (CI runs `check`, which is
non-mutating).

## Decisions

- Disable the autofix at the rule level in `biome.json`, not by removing the
  `check:fix:unsafe` step — rules out neutering all unsafe fixes when only this
  one conflicts.
- Keep `noNonNullAssertion` as a lint signal (do not delete the rule) — rules
  out silently dropping the diagnostic; `bun run check` should still surface
  non-null assertions, just never rewrite them.
- Scope the override to `noNonNullAssertion` only — rules out re-tuning unrelated
  biome rules in the same change.

## Task checklist

- [ ] Override `noNonNullAssertion` in `biome.json` so neither `check:fix` nor
  `check:fix:unsafe` rewrites `!` to `?.` (e.g. set the rule's `fix` to `none`,
  keeping its diagnostic level), or drop the rule to a non-`--write` level.
- [ ] Confirm a file containing a type-correct `match[1]!.trim()` (or similar
  indexed non-null assertion) survives `bun run check:fix:unsafe` unchanged.
- [ ] Update docs per Documentation updates.

## Acceptance criteria

- [ ] `bun run check:fix:unsafe` leaves a type-correct indexed non-null
  assertion (e.g. `match[1]!.trim()`) unchanged — it is not rewritten to `?.`.
- [ ] `bun run ready` completes its `typecheck` step without a TS2322 introduced
  by the preceding `check:fix:unsafe` step on such a file.
- [ ] `bun run check` still reports `noNonNullAssertion` as a diagnostic (the
  rule is disabled for autofix only, not removed) — unless the chosen direction
  is dropping it to a non-`--write` level, in which case `check` behavior is
  documented.
- [ ] No biome rule other than `noNonNullAssertion` changes level or fix
  behavior in `biome.json`.

## Documentation updates

- [ ] `v1/docs/operator-runbook.md` — the `check:fix:unsafe` note (~line 161)
  records that the non-null-assertion autofix is disabled and why (autofix vs.
  `noUncheckedIndexedAccess` typecheck conflict).
- [ ] `v2/docs/v1-behaviors.md` — note in the ready-gate parity entries that
  `check:fix:unsafe` no longer rewrites valid `!` non-null assertions.
