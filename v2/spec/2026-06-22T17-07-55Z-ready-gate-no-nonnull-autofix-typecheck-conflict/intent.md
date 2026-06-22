---
name: ready-gate-no-nonnull-autofix-typecheck-conflict
---

# Ready gate stops rewriting valid `!` non-null assertions into typecheck failures

## Problem

`bun run ready` runs `check:fix:unsafe` (`biome check --write --unsafe .`), which
auto-applies biome's `noNonNullAssertion` unsafe fix: `arr[i]!.x` → `arr[i]?.x`.
Under `noUncheckedIndexedAccess`, the rewritten `?.` is `T | undefined`, so a
later assignment to a non-`undefined` type fails typecheck (TS2322). The gate
mutates type-correct code into a type error, then fails its own typecheck step —
the spec becomes unfinalizable while CI stays green (CI runs `check`, not
`check:fix:unsafe`).

## Behavior

`bun run ready` no longer rewrites a valid `!` non-null assertion into code its
own typecheck step rejects. A file containing a type-correct `match[1]!.trim()`
survives the gate unchanged and the gate's typecheck passes.

## Direction

Disable the `noNonNullAssertion` unsafe autofix (or drop the rule to a
non-`--write` level). Keep the change scoped to removing the
autofix/typecheck conflict; do not re-tune unrelated biome rules.

## Out of scope

- Broad biome rule re-tuning beyond the autofix/typecheck conflict.
- The intent-split spec already fixed in-place this session.

## Documentation updates

- `v1/docs/*` wherever the ready gate / `check:fix:unsafe` is documented — note
  the non-null-assertion autofix policy.
- `v2/docs/v1-behaviors.md` — gate behavior change to the parity baseline.

## Prerequisites
