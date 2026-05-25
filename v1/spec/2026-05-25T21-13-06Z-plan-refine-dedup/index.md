# Plan Refine Cross-Turn Dedup

repo: cbrenner04/jarvis

Refine is append-only: each turn writes its own `## Refine turn N` and never
touches earlier turns. The decisions-ledger fragment fixed the shape *within* a
turn, but nothing stops a later turn from restating decisions an earlier turn
already recorded — so multi-turn intents accrete the same calls in slightly
different words (see #147's 171-line intent). This is the prompt-only,
within-append-only brake: a refine turn records only genuinely new decisions, or
skips. Superseded by the single-living-ledger spec, which deletes the turn
structure entirely; ship this first as the cheap immediate win.

- [x] [00 - refine cross-turn dedup directive](./00-refine-cross-turn-dedup.md)
