---
name: tui-attention-segment-suppresses-stale-terminal-incidents
---

# The needs-attention segment buries the current gate under dead failures and abandoned gates

## Problem

`jarvis tui`'s needs-attention segment pins every retained failed-run, blocked-run, rejected-gate, failed-stage, and publication-failure incident with no recency bound and no way to dismiss one. Dogfooding 2026-08-16 showed `── Needs attention (50) ──` while almost nothing was live: the machine held 48 failed/blocked runs across 30 days, all terminal records from prior sessions. The segment inverts its own purpose — the one or two incidents that actually need the operator are buried under dozens of long-dead ones, and the pre-cap count (50) reads as a crisis when it is history.

`approve`/`reject` do not clear these rows (they act only on awaiting-gate rows), a daemon bounce re-derives them from durable state, and they only fall off as the daemon's ~50-newest-terminal retention rotates — which new failures immediately refill. There is no operator action that clears them today.

**Abandoned gates crowd the cap the same way (2026-08-16 follow-on).** Gates are sorted before failures and, within gates, **oldest-`sinceMs`-first**, capped at six (`compareAttentionRows` / `ATTENTION_ROW_CAP` in `tui-attention-rows.ts`). With seven-plus awaiting gates — most of them ancient abandoned dogfood pipelines from prior phases (branch keys like `tui-pipeline-tree-model`, `implement-preflight-stale-workspace-gates`) — the six oldest fill the cap and the operator's *current* gate lands in the display-only, non-selectable `+N more`. Because the dock `approve` verb takes no id arguments (it acts only on the selected row), a gate that cannot be selected cannot be approved from the TUI at all — the operator is forced to `jarvis pipeline approve <id> <stage> <branch>` from a shell. So the segment's own "gates always surface" guarantee is defeated by a stale-gate backlog: the gate you need is present in the model but unreachable.

## Decisions

- The needs-attention segment surfaces only incidents that are still actionable-now: an unresolved awaiting or rejected gate always qualifies; a terminal failure/blocked/publication-failure incident qualifies only within a bounded recency window off its durable timestamp (exact window a plan/design choice — hours, not days). Rules out pinning every retained terminal incident forever.
- A terminal incident with no durable timestamp (legacy row) is not pinned, rather than pinned undated at the top. Rules out undated dead rows dominating the segment.
- The `── Needs attention (N) ──` heading counts only the surfaced (post-suppression) actionable set, so the number reflects what needs the operator, not retained history. The existing six-row cap and `+N more` overflow are unchanged.
- A stale-gate backlog must not crowd the current gate out of reach. The oldest-first, six-cap gate ordering is the wrong default when many gates are parked: the plan chooses a fix (candidates — never cap gates so all gates always render while only failures are capped; or sort the most-recently-reached gate first; or make the `+N more` overflow navigable/selectable). Rules out the current behavior where six ancient gates hide the one the operator is working on. A genuinely old gate still needing a decision is not aged out — it is just not allowed to displace a newer one.
- No new subcommand and no durable schema change: suppression and gate ordering are read-time transforms over the same records the segment already reads. (An id-bearing `approve`/`reject` so an unselectable gate can still be actioned is tracked in `tui-dock-command-grammar-mirrors-cli`, not here.)

## Acceptance criteria

- [ ] A terminal failed/blocked/publication-failure incident whose durable timestamp is older than the recency window is not surfaced in the needs-attention segment, pinned by a pure-function test over the segment model.
- [ ] An awaiting or rejected gate is surfaced regardless of age, pinned by a test.
- [ ] With more awaiting gates than the failure cap, the operator's newest/current gate is reachable (rendered and selectable), not displaced into non-selectable overflow by older gates, pinned by a test over the chosen gate-ordering fix.
- [ ] A recent (within-window) terminal failure is still surfaced, pinned by a test.
- [ ] A terminal incident with no durable timestamp is not surfaced, pinned by a test.
- [ ] The segment heading count reflects only surfaced incidents, pinned by a test.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — needs-attention now surfaces only actionable-now incidents (gates always; terminal failures only within the recency window); explain why old failures no longer accumulate and that there is no manual dismiss needed.
