---
name: check-fix-unsafe-rewrites-nonnull-assertions
---

# `check:fix:unsafe` rewrites valid `!` non-null assertions into typecheck failures, blocking finalization

## Problem

The ready gate runs `bun run check:fix:unsafe` (`biome check --write --unsafe .`),
which **auto-applies** biome's `noNonNullAssertion` unsafe fix: it rewrites
`arr[i]!.method()` → `arr[i]?.method()`. Under the repo's `noUncheckedIndexedAccess`
(`arr[i]` is `T | undefined`), the rewritten `?.` yields `T | undefined`, so any
assignment to a non-`undefined` type then **fails typecheck** (TS2322).

Net effect: the gate rewrites type-correct code into a type error, then fails its
own typecheck step. The spec becomes **unfinalizable** — `bun run ready` can never
pass, the PR stays draft, and (worse) CI is *green* (CI only runs `check`, not
`check:fix:unsafe`), so the conflict is invisible until a local finalize.

Observed this session: `intent-split-emit-contract-flaky` impl wrote
`match[1]!.trim()` (type-correct, CI-green). Every `bun run ready` rewrote it to
`match[1]?.trim()` and failed typecheck. Required a manual operator fix
(`(match[1] ?? "").trim()`) to break the loop. Any future spec's gate that touches
a file containing such a pattern would hit the same wall — a latent landmine
across the codebase.

## Direction

Stop the gate from rewriting valid non-null assertions into type errors. Options
(pick/compose):

- **Disable the `noNonNullAssertion` unsafe fix** in biome config (keep it as a
  warning/lint, but not an auto-`--write` rewrite), so the gate never mutates
  `!` into `?.`.
- **Drop `noNonNullAssertion` to off/info** if the repo accepts non-null
  assertions (they're already used widely with `!`).
- Narrowly: ensure `check:fix:unsafe` cannot produce a state that its own
  subsequent typecheck rejects — i.e. no autofix that conflicts with
  `noUncheckedIndexedAccess`.

## Out of scope

- Broad biome rule re-tuning beyond the autofix/typecheck conflict.
- The intent-split spec itself (already fixed in-place this session).

## Documentation updates

- `v1/docs/*` wherever the ready gate / `check:fix:unsafe` is documented — note
  the autofix policy for non-null assertions.

## References

- `scripts/ready.ts` (runs `check:fix:unsafe`); biome config (`biome.json` or
  equivalent) `noNonNullAssertion` rule.
- Evidence: `intent-split-emit-contract-flaky` finalize loop, `v1/src/commands/intent.ts:241`.
- Relates to the single-operator gate flow; a gate that rewrites valid code is a
  correctness bug in the gate, not the spec.
