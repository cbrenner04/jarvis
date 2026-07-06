## Verdict

Refinement required. The following outcomes must be addressed in `00-queue-view-section.md`:

1. **Correct the ordering claim.** "Matching daemon promotion order" overstates what's true: memory-headroom gating processes the queue strictly oldest-first, but the daemon separately skips promotion of a queued run whose project/branch is already claimed by an active run. Scope the FIFO-ordering decision/descriptor explicitly to the memory-headroom case (the only queuing cause today), or note the skip exception, so the spec doesn't imply an ordering guarantee the daemon doesn't provide.

2. **Specify empty-section rendering.** The spec is silent on what renders when one or both groups are empty. Add an explicit decision: "Runs" always renders (even empty), "Queue" heading renders only when at least one queued run exists — consistent with the existing "No runs." precedent for the whole-list-empty case.

3. **Clarify section/row layout.** "The queue group under a 'Queue' heading with the FIFO ordering and admission descriptor above" is ambiguous about whether the descriptor is a separate line or inline per row. State plainly: Runs section first, then a "Queue" heading, then each queued row on one line including its descriptor (parity with how non-queued rows render as single lines).

4. **Decide row field parity explicitly.** Non-queued rows show runId, project, branch, status, and liveness. The spec only mandates project/branch/descriptor for queue rows, leaving runId/status ambiguous. Since queue rows aren't interactive, decide explicitly whether runId and status are kept for visual/log correlation (recommended: keep runId and status, replace only liveness with the descriptor) — this must be a stated decision, not left to implementer judgment.

5. **Name cancellation as explicit non-goal.** The spec's own motivation (visibility into stuck/waiting runs) foreseeably raises "can the operator cancel a queued run?" Add a one-line non-goal stating that cancelling/dequeuing a queued run is out of scope because no daemon dequeue RPC exists — this subspec is display-only. This closes an obvious gap that otherwise reads as an oversight.

6. **Tighten the doc-update target.** Replace the hedged "(or the TUI's existing behavior description, if present)" with the concrete, confirmed location: `v2/docs/v2-architecture.md`'s existing TUI behavior section (the file already has one).

Minor wording fixes also needed, low-stakes but should be folded in during refinement:

7. Add a checklist note that no wire/type changes are needed — the descriptor is a TUI-side literal, since `DaemonListRunRow` has no reason field and none is being added.

8. Reword the steering-guard rationale to describe effect rather than implying an intentional check: queued runs are absent from `activeRuns`, so steering RPCs return `run_not_active` as a side effect of that lookup — not because of a queued-specific guard.

9. Drop "e.g." from the descriptor acceptance criterion since the decision already pins an exact fixed string; state the literal string as the actual requirement.

No refinement needed for the cursor-navigation concern — confirmed no arrow-key/cursor selection path exists in the monitor view; selection is exclusively via the programmatic `selectRun` control the spec already restricts to non-queued rows. Optionally, one confirming line in the spec can preempt future reviewer confusion, but this is not required.