# Cursor cost: make it measurable-enough, or cleanly segmentable

## Problem

Cursor (Composer 2.5) cost is **estimated from prompt + stdout tokens only** —
tool calls and sub-turns are invisible from the CLI — so cursor runs report a
misleadingly tiny `~$0.03` and skew as cost outliers. One run this session
(2026-06-27) returned a model with **no price-table entry at all**. As cursor
becomes a regular cheap tier, this poisons historical cost analysis: estimated
cursor rows sit in the same column as *measured* codex/claude spend, and the
operator may have to drop cursor by hand to keep comparisons honest.

## Direction

Two tracks; do the spike first, then ship the data-hygiene fixes regardless.

1. **Spike: can cursor cost be measured?** Check whether the cursor CLI persists
   a session/usage artifact (the way codex does — see `v1/src/agents/codex-session.ts`
   correlating a session file) or exposes a `--json`/usage flag with real token
   counts. If so, the cursor adapter reads true usage instead of estimating. This
   is the only path to *measured* cursor cost — confirm or rule it out before
   accepting estimation forever.

2. **Data hygiene, regardless of the spike outcome:**
   - **No unpriced runs.** Every cursor model resolves to a price key (even a
     notional/reference one); a missing price-table entry is a bug, not a blank.
   - **Segment estimated vs measured.** Cost analysis keys off the existing
     `usage_source` (`estimated` vs agent-sourced) so estimated cursor rows can be
     excluded or treated separately — the clean "drop it" lever, no manual surgery.
   - **Imputed notional cost for comparison.** Since Composer 2.5 is
     subscription-included, the honest comparison cost is estimated-tokens × a
     reference rate, explicitly labeled *imputed* — used only for relative agent
     comparison, never summed into real spend.

Done-state: a cursor run is never unpriced, is always tagged estimated-vs-measured,
and historical cost analysis stays usable whether the operator imputes or drops it.

Owner update: <https://cursor.com/dashboard/usage?from=2026-06-21&to=2026-06-27> this shows line by line tokens (only single column). But you can export a csv of the data, and they give you a link if the export doesn't download. <https://cursor.com/api/dashboard/export-usage-events-csv?startDate=1782000000000&endDate=1782604799999&strategy=tokens>. That data is all we need. Composer 2.5 is priced in the data json to the api price so we can estimate cost. Now it'll be interesting lining this up with our data but hopefully its possible. For reference that csv is [cursor usage](.scratch/cursor-usage-events-2026-06-27.csv). We should make sure to only use the token data and not price data from that export. Price is to be estimated based on the price in our price library.

## Documentation updates

- `v2/docs/v1-behaviors.md` — record cursor cost provenance (measured if the spike
  finds an artifact, else estimated + imputed-notional) and the segmentation rule.
- Cost-reporting standard in `v1/docs/operator-runbook.md` — note estimated-vs-measured
  segmentation so report CSVs don't blend the two.
