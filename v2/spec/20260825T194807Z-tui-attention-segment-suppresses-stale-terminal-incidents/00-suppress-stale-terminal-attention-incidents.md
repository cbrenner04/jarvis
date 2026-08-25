# 00 - Suppress stale and undated terminal attention incidents

## Problem

`buildAttentionRows` projects every retained failed-stage, failed-run, blocked-run, and terminal-publication-failure record with no recency bound, so `jarvis tui` pinned `── Needs attention (50) ──` with 48 terminal records from prior sessions across 30 days; nothing but retention eviction removes them, and the heading count reports that whole backlog as actionable.

## Decision ledger

- The recency window is 12 hours, held as `ATTENTION_TERMINAL_RECENCY_MS` in `v2/src/tui/tui-attention-rows.ts`; rules out a day-scale window, which reproduces the observed multi-day backlog.
- Suppression is one read-time predicate (`isSurfacedIncident(row, nowMs)`) applied to the assembled incident list before sort and cap; rules out filtering inside each of the four incident builders, which would restate the rule four times and diverge.
- The window test is inclusive (`nowMs - row.sinceMs <= ATTENTION_TERMINAL_RECENCY_MS`), so a future-dated incident from clock skew surfaces; rules out treating negative age as stale.
- `awaiting-gate` and `rejected-gate` bypass the window entirely; rules out aging out an undecided gate, which no other surface would then offer.
- A terminal incident with `sinceMs === null` is suppressed; rules out undated dead rows dominating the segment, which is exactly where the existing undated-last ordering lands them once dated rows are suppressed.
- `buildAttentionRows` takes `nowMs` as a required fourth parameter and `options` loses its default; rules out an omittable clock that silently falls back to `Date.now()` inside the projection.
- Exported TUI entry points that gain the clock keep the established `nowMs = Date.now()` edge default (`monitorDockLines`); internal helpers take it required; rules out churning the ~20 existing `monitorDockLines(state)` call sites in tests.
- Every projection call site threads the frame's `nowMs`, so painted rows and the selectable id set are computed against one clock; rules out per-call-site clocks that let `monitorSelectableNodeIds` offer an id the pane never painted.
- `total` stays the length of the post-suppression list, so the heading counts the surfaced set; rules out reporting a pre-suppression total that reads as a crisis over an empty segment.
- An incident that ages out between refreshes leaves the selectable set like any resolved incident, with no new selection-repair path; rules out pinning a selection to a row the projection no longer produces.

## Task checklist

- [ ] Add `ATTENTION_TERMINAL_RECENCY_MS` and `isSurfacedIncident(row, nowMs)` to `v2/src/tui/tui-attention-rows.ts`, ordered gate bypass, then undated rejection, then the inclusive window comparison, and filter the assembled incidents with `.filter((row) => isSurfacedIncident(row, nowMs))` before `.sort(compareAttentionRows)` so `total` and `overflow` derive from the surfaced set.
- [ ] Make `nowMs` a required fourth parameter of `buildAttentionRows` and thread the frame clock through every caller: `leftPaneAttentionRowCount`, `leftPaneTreeMaxVisibleRows`, `monitorLeftPaneTreeRows` (its currently unused `_nowMs`), `withLeftPaneTreeScrollFollow`, `resolveAttentionTargetId`, `dockHintLine`, and `monitorDockLines` in `v2/src/tui/tui-monitor-lines.ts`; `selectedAttentionRow`, `approveRejectSelectionError`, `resolvePipelineSteeringDispatch`, and `revealSelectedAttentionTarget` in `v2/src/tui/tui-entry.tsx`; and `renderDockContent` in `v2/src/tui/tui-ink-monitor.tsx`, which already has the frame clock in scope at its call site.
- [ ] Pin suppression, the within-window negative case, the gate bypass, the undated case, and caller-clock evaluation in `v2/src/tui/tui-attention-rows.test.ts`, each with an in-body directive on the real guard (no production inversion hooks).
- [ ] Pin the painted heading count and the empty-segment case in `v2/src/tui/tui-monitor-lines.test.ts`, and pin that suppressed incidents leave the selectable id set.
- [ ] Update the durable docs listed below in the same change.

## Acceptance criteria

- [ ] `v2/src/tui/tui-attention-rows.test.ts` — `a terminal failure older than the recency window is not surfaced`; Keystone checkpoint: a failed run dated past the window against a caller-supplied clock is absent from `rows` and `total`, the test fails against the pre-fix always-surface projection, and an in-body directive restoring baseline always-surface semantics (`if (GATE_KINDS.has(row.kind)) return true;` replaced by `return true;`) turns the scoped test red.
- [ ] `v2/src/tui/tui-attention-rows.test.ts` — `a terminal failure inside the recency window is still surfaced`; Mutation checkpoint: the negative case proves suppression does not swallow live failures, and an in-body directive replacing the window comparison (`return nowMs - row.sinceMs <= ATTENTION_TERMINAL_RECENCY_MS;` replaced by `return false;`) turns the scoped test red.
- [ ] `v2/src/tui/tui-attention-rows.test.ts` — `an awaiting or rejected gate is surfaced regardless of age`; Mutation checkpoint: gates dated weeks before the window still project, and an in-body directive inverting the gate bypass (`if (GATE_KINDS.has(row.kind)) return true;` replaced by `if (GATE_KINDS.has(row.kind)) return false;`) turns the scoped test red.
- [ ] `v2/src/tui/tui-attention-rows.test.ts` — `a terminal incident with no durable timestamp is not surfaced`; Mutation checkpoint: an undated failed stage and an undated failed run stay out of `rows` and `total`, and an in-body directive inverting the undated guard (`if (row.sinceMs === null) return false;` replaced by `if (row.sinceMs === null) return true;`) turns the scoped test red.
- [ ] `v2/src/tui/tui-attention-rows.test.ts` — `recency is evaluated against the caller's clock, not wall-clock time`; Mutation checkpoint: a fixture whose supplied clock sits years behind wall time keeps its within-window failure surfaced, and an in-body directive swapping the threaded clock for wall time (`isSurfacedIncident(row, nowMs)` replaced by `isSurfacedIncident(row, Date.now())`) turns the scoped test red.
- [ ] `v2/src/tui/tui-monitor-lines.test.ts` — `Needs attention heading counts only surfaced incidents`: the painted heading reports the post-suppression count, and a state whose every incident is stale paints no heading, rows, or overflow line and reserves no left-pane height; the test fails against the pre-fix pre-suppression total.
- [ ] `v2/src/tui/tui-monitor-lines.test.ts` — `monitorSelectableNodeIds omits stale attention incidents at the frame clock`: a suppressed incident's attention id is unreachable by `j`/↓/↑, and the selectable attention prefix equals the painted attention rows for the same clock.
- [ ] `v2/src/tui/tui-attention-rows.test.ts`, `v2/src/tui/tui-monitor-lines.test.ts`, `v2/src/tui/tui-entry.test.tsx`, and `v2/src/tui/tui-ink-monitor.test.tsx` stay green under the required `nowMs` argument (within-window and gate behavior unchanged by the threading).
- [ ] `v2/docs/operator-runbook.md` and `v2/docs/v1-behaviors.md` state that the segment surfaces gates regardless of age, terminal failures only inside the 12-hour window, never undated terminal incidents, and that the heading counts the surfaced set — with no manual dismiss step.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — the needs-attention segment paragraph: membership is now gates (any age) plus terminal failures whose durable timestamp is within 12 hours; undated terminal incidents never surface; `── Needs attention (N) ──` counts the surfaced set; stale incidents rotate out on their own, so no dismiss action is needed.
- `v2/docs/v1-behaviors.md` — update the `buildAttentionRows` projection entry and the attention-segment paint entry to record the recency window, undated suppression, the caller-supplied evaluation clock, and the post-suppression count as current v2 behavior.
