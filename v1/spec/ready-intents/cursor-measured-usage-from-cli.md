---
name: cursor-measured-usage-from-cli
---

# Cursor adapter reports measured usage when the CLI exposes it

When the measurement spike documents a reliable per-run CLI path, wire the
cursor adapter to read true token usage from that source (session-file
correlation and/or structured CLI output) instead of `estimateCursorUsage`.

Successful cursor iterations then emit agent-sourced usage (`usage_source`
`agent` or codex-style `computed` from correlated artifacts — match the
spike's named path) with `cost_source` following existing enrichment rules.
Estimation remains the fallback when correlation fails, with explicit
warnings.

Update `v2/docs/v1-behaviors.md` cursor provenance to measured-when-available.

## Decisions

- Implement only the spike-named CLI path; do not add dashboard-export reconciliation here — rules out scope creep into async operator CSV workflows.
- Estimation stays as fallback on correlation miss, not removed — rules out all-or-nothing measured-only cursor.

## Out of scope

- Dashboard CSV import or post-hoc reconciliation.
- Data-hygiene fixes (unpriced runs, segmentation, imputed cost).

## Prerequisites

- Spike verdict documents a CLI path to real per-run cursor token counts
