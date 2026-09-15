# 01 — Research note

Markdown note paired with the 00 script, same timestamp prefix, reporting its measured results.

## Decisions

- Every number in the note is copied from script output; no hand-computed figures — keeps the note reproducible.
- Totals framed as observed partial, catalog-standardized cost; not bills, invoices, paid-vs-free, or current provider rates; brief historical price provenance caveat.
- Stay at invocation grain: no causal model rankings across unmatched tasks; subprocess-ok ≠ run completion ≠ merged delivery ≠ quality.
- Next experiments limited to ones cited to a specific table.

## Acceptance criteria

- [ ] `v2/docs/research/<UTC-timestamp>-september-api-cost.md` documents snapshot fingerprints, filters, and the exact rerun command for the 00 script.
- [ ] Note contains totals, the grouped breakdowns, fallback/retry/failure/stall overhead (unpriced time explicit), cost components with rates and price-key mapping, recomputed-vs-returned deltas, coverage, largest contributors, and evidence-backed next experiments; each figure matches the script output.
- [ ] Note states the null-as-zero formula behavior, the Codex cache semantics, and the linked-step suffix collapse rule.
- [ ] Each next-experiment suggestion cites the specific table or figure that motivates it.
- [ ] `bun run typecheck` and `bun run lint:md` pass.

## Documentation updates

- The note is the documentation update.
