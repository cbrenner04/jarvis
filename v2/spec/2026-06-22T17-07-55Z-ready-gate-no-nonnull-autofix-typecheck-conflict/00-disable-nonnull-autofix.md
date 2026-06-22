# Disable noNonNullAssertion autofix in the ready gate

## Problem

`bun run ready` runs `check:fix:unsafe` (`biome check --write --unsafe .`,
`scripts/ready.ts:206`) just before its `typecheck` step. During a real gate
run, biome's `noNonNullAssertion` unsafe fix was observed rewriting
`match[1]!.trim()` → `match[1]?.trim()`. Under `noUncheckedIndexedAccess` the
rewritten `?.` is `T | undefined`; a downstream assignment to a non-`undefined`
type then fails typecheck (TS2322). The gate mutates type-correct code into a
type error and fails its own typecheck step, leaving the spec unfinalizable
while CI stays green (CI runs `check`, which is non-mutating).

## Decisions

- Disable the rule's `fix` in `biome.json`, keeping its diagnostic level — rules
  out removing the `check:fix:unsafe` step (neuters all unsafe fixes when only
  this one conflicts) and rules out deleting the rule (silently drops the
  diagnostic). `bun run check` still surfaces non-null assertions; only the
  rewrite stops.
- Pin the override to keep `noNonNullAssertion` at its existing recommended
  diagnostic level (`warn`) with `fix: "none"` — rules out leaving the level
  ambiguous (implementer guessing) or silently downgrading severity.
- Scope the override to `noNonNullAssertion` only — rules out re-tuning unrelated
  biome rules in the same change.
- Add a durable config-assertion test that the override exists, rather than a
  one-shot manual check — rules out relying on an ephemeral hand-typed file that
  a future biome upgrade could silently regress; the repo already
  regression-tests gate invariants (`v1/test/ready-script.test.ts`).

## Task checklist

- [ ] Add a `noNonNullAssertion` override in `biome.json` setting `fix: "none"`
  and keeping its recommended diagnostic level (`warn`), so `check:fix:unsafe`
  no longer rewrites `!` to `?.`. (Safe `check:fix` never applied this unsafe
  fix; only `check:fix:unsafe` did.)
- [ ] Add a regression test asserting `biome.json` carries the
  `noNonNullAssertion` override with `fix: "none"` and its diagnostic level
  retained.
- [ ] Update docs per Documentation updates.

## Acceptance criteria

- [x] `bun run check:fix:unsafe` leaves a type-correct indexed non-null
  assertion (e.g. `match[1]!.trim()`) unchanged — it is not rewritten to `?.`.
- [x] `bun run ready` completes its `typecheck` step without a TS2322 introduced
  by the preceding `check:fix:unsafe` step on such a file.
- [x] `bun run check` still reports `noNonNullAssertion` as a `warn` diagnostic
  (the fix is disabled; the rule is not removed and its level is unchanged).
- [x] A regression test fails if the `noNonNullAssertion` override is removed
  from `biome.json` or its `fix` is re-enabled.
- [x] No biome rule other than `noNonNullAssertion` changes level or fix
  behavior in `biome.json`.

## Documentation updates

- [ ] `v1/docs/operator-runbook.md` — the `check:fix:unsafe` note (~line 161)
  records that the non-null-assertion autofix is disabled (`fix: "none"`, level
  retained) and why (autofix vs. `noUncheckedIndexedAccess` typecheck conflict).
- [ ] `v2/docs/v1-behaviors.md` — amend the ready-pipeline-order entry
  (`scripts/ready.ts`: install → check:fix:unsafe → typecheck → test → check) to
  note `check:fix:unsafe` no longer rewrites valid `!` non-null assertions.
