Verifying the implementation against the spec and advocate findings before issuing the verdict.
# Verdict

## Required outcomes

1. **Eligible typed `log` must fully tear down the monitor before entering log follow.** The spec pins that eligible `log` performs the same monitor teardown as a normal monitor exit, then enters `runTuiLogFollow` — matching `jarvis tui log <run-id>`, which never mounts the monitor. Today, eligible `log` unblocks the quit race and awaits `runTuiLogFollow` while still inside the monitor `try`; `session.close()`, refresh/tick scheduler shutdown, and client cleanup run only in `finally` after follow returns. That leaves the ink session and background refresh/tick work live during follow, which contradicts the spec decision and runbook (“tears down the monitor and does not return”).

2. **A regression test must prove teardown precedes follow entry.** The happy-path test passes because injected `runTuiLogFollow` resolves immediately, so `finally` runs right after and `view.isClosed()` does not expose the ordering bug. Add coverage that holds follow open (deferred spy) and asserts monitor close and scheduler shutdown complete before follow proceeds. Without this, the spec’s lifecycle requirement is unfalsifiable.

3. **Runbook `not_a_run` wording must match pinned eligibility.** Implementation reports `not_a_run` whenever `selectedNodeId` is set and `selectedRunIdFromState` is null — pipeline, stage, or any stale/evicted run id absent from `state.runs`. The Dock-commands feedback table narrows that to “pipeline or stage,” which understates actual behavior and diverges from the spec’s eligibility rule. Align the table prose with the pinned semantics; do not change the code to emit steering’s `stale_non_expandable` unless the spec is reopened.

## Not required before merge

- **Admission-pending silent drop for `log`:** Inherited `submitCommand` policy; same as `expand`/`collapse`. Verdict-plan marked non-blocking.
- **Unattributed-run test:** Valid coverage gap; spec AC names attributed happy path, pipeline/stage ineligibility, and `no_selection`. Eligibility already flows through `selectedRunIdFromState`, which includes unattributed rows in `state.runs`. Optional hardening, not a merge blocker.
- **Unattributed doc callout:** Runbook table already keys on `selectedRunIdFromState`; optional prose clarification only.
- **Parser `recognized_unavailable` cleanup, redundant guard, `intent.md` checkboxes:** Cosmetic or harness bookkeeping; no operator impact.