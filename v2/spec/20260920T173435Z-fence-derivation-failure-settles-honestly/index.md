# Fence-derivation failure is named and logged

Derivation failure in `deriveGateAllowedPaths` currently collapses to bare `undefined` and reaches the write-loop as an unlogged bare `Error`, so no caller can report which failure happened.

Settlement for a published lane (red ready gate plus an underivable fence) is deliberately **out of scope here** and deferred to its own intent — see `## Deferred` in `intent.md`.

- [ ] [00-named-derivation-failure-reasons.md](00-named-derivation-failure-reasons.md) — every derivation failure returns a distinct named reason instead of bare `undefined`
- [ ] [01-log-derivation-reason-before-settlement.md](01-log-derivation-reason-before-settlement.md) — the write-loop writes the named reason to the run log before settling
