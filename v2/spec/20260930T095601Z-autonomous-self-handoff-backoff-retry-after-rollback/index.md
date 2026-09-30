# Autonomous self-handoff backoff retry after rollback

After a rolled-back self-handoff, exponential backoff is recorded in `startStableDigestTrigger`, but `startDaemonRuntime`'s sampling interval returns before `onTick` while `isRetiring()` stays true (even after the self-heal gate), so the retry never runs.

Prerequisites (committed): handoff rollback clears handoff-origin `supersede` and reopens admission — [`20260930T014709Z-handoff-rollback-restores-admission-after-handoff-supersede`](../20260930T014709Z-handoff-rollback-restores-admission-after-handoff-supersede/index.md); retiring sole-owner self-heal on the sampling tick — [`20260930T052340Z-retiring-sole-daemon-self-heals-admission`](../20260930T052340Z-retiring-sole-daemon-self-heals-admission/index.md).

- [ ] [00-sampling-interval-backoff-retry-through-retiring.md](00-sampling-interval-backoff-retry-through-retiring.md) — keep digest sampling ticks invoking the trigger through stranded retiring; regression and docs
