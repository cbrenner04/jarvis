Reviewing the implementation against the spec and verdict-plan to issue a self-contained verdict.
## Verdict

No required outcomes. Slice 00 meets its acceptance criteria; the actuator has nothing to fix on this branch.

**Rationale (for merge judgment only — not actuator work):**

- **Flatten change:** `flattenMonitorPipelineTree` returns the full ordered flatten for current expansion/selection inputs; `_maxVisibleRows` is intentionally unused; removing `dropOldestTerminalPipeline` is allowed by the subspec.
- **Tests:** Overflow retention uses the active+terminals fixture, asserts every pipeline id and overflow (`length > 5`), names the FIFO-reintroduction mutation checkpoint, renames the describe block, reconciles the collapse pin to collapse-only semantics, and updates the entry test to expect full flatten over budget with all pipeline ids retained.
- **Docs:** `v2/docs/v1-behaviors.md` documents interim full-flatten and softens the descend-eviction caveat as required.
- **Explicitly out of slice-00 actuator scope:** serial handoff updates to `tui-monitor-scroll-viewport-selectables` and `tui-entry-reversible-descend-navigation` ready-intents (sequenced after landing, before slice 01); end-to-end `j`/`k` reversibility pins; viewport paint/selectable-vs-painted split; stale planning artifacts (`intent.md`, overhaul brief); optional hardening (full display-node retention beyond pipeline ids); the stale “visible tree rows” comment in `tui-monitor-lines.ts` (not in this subspec’s documentation updates).