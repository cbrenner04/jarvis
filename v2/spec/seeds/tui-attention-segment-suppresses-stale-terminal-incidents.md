---
name: tui-attention-segment-suppresses-stale-terminal-incidents
---

# The needs-attention segment buries live gates under dozens of dead terminal failures

## Problem

`jarvis tui`'s needs-attention segment pins every retained failed-run, blocked-run, rejected-gate, failed-stage, and publication-failure incident with no recency bound and no way to dismiss one. Dogfooding 2026-08-16 showed `── Needs attention (50) ──` while almost nothing was live: the machine held 48 failed/blocked runs across 30 days, all terminal records from prior sessions. The segment inverts its own purpose — the one or two incidents that actually need the operator are buried under dozens of long-dead ones, and the pre-cap count (50) reads as a crisis when it is history.

`approve`/`reject` do not clear these rows (they act only on awaiting-gate rows), a daemon bounce re-derives them from durable state, and they only fall off as the daemon's ~50-newest-terminal retention rotates — which new failures immediately refill. There is no operator action that clears them today.

## Decisions

- The needs-attention segment surfaces only incidents that are still actionable-now: an unresolved awaiting or rejected gate always qualifies; a terminal failure/blocked/publication-failure incident qualifies only within a bounded recency window off its durable timestamp (exact window a plan/design choice — hours, not days). Rules out pinning every retained terminal incident forever.
- A terminal incident with no durable timestamp (legacy row) is not pinned, rather than pinned undated at the top. Rules out undated dead rows dominating the segment.
- The `── Needs attention (N) ──` heading counts only the surfaced (post-suppression) actionable set, so the number reflects what needs the operator, not retained history. The existing six-row cap and `+N more` overflow are unchanged.
- Awaiting/rejected gates are never suppressed by recency — an old gate genuinely still needs a decision. Rules out aging out real pending work.
- No new subcommand and no durable schema change: suppression is a read-time filter over the same records the segment already reads.

## Acceptance criteria

- [ ] A terminal failed/blocked/publication-failure incident whose durable timestamp is older than the recency window is not surfaced in the needs-attention segment, pinned by a pure-function test over the segment model.
- [ ] An awaiting or rejected gate is surfaced regardless of age, pinned by a test.
- [ ] A recent (within-window) terminal failure is still surfaced, pinned by a test.
- [ ] A terminal incident with no durable timestamp is not surfaced, pinned by a test.
- [ ] The segment heading count reflects only surfaced incidents, pinned by a test.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — needs-attention now surfaces only actionable-now incidents (gates always; terminal failures only within the recency window); explain why old failures no longer accumulate and that there is no manual dismiss needed.
