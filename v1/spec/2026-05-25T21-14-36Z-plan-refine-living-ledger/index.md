# Plan Refine Single Living Ledger

repo: cbrenner04/jarvis

Refine's append-only contract is what forces multi-turn intents to accrete:
each turn appends `## Refine turn N` and may never edit prior turns, so the
document carries turn-archaeology and restated decisions instead of one current
record (see #147). This removes append-only and makes refine maintain a single
living decisions ledger, rewritten and consolidated each turn — the intent reads
as one artifact, not a changelog. Applies the "cut prose, never decisions"
principle (already in the ledger fragment and subtractive review) to refine's own
output. Depends on / supersedes the cross-turn dedup spec.

- [ ] [00 - single living ledger](./00-single-living-ledger.md)
