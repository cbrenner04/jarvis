# Dismiss Run TUI Display

repo: cbrenner04/jarvis

- [x] [00 - Dismissed runs leave the work tree](./00-hide-dismissed-runs-from-work-tree.md)
- [ ] [01 - `D` widens the run `list` request to dismissed runs](./01-show-dismissed-toggle-covers-runs.md)

Scope note: TUI surface only — `v2/src/tui/tui-monitor-pipeline-tree.ts` plus the row builder and request wiring that read it (`tui-monitor-lines.ts`, `tui-attention-rows.ts`, `tui-daemon-client.ts`, `tui-entry.tsx`, `tui-log-follow-entry.tsx`). The durable run `dismissedAt` column with its store operations, the `dismiss`/`undismiss` RPCs, the default-excluding `list` projection with `includeDismissed`, and `jarvis run list --all` already landed (`dismiss-run-durable-flag`, `dismiss-run-rpc`, `dismiss-run-cli`); the session-only `D` toggle and the `(dismissed)` row marker already landed for pipelines (`dismiss-pipeline-tui-display`). No daemon, store, or CLI change lands here. 00 filters dismissed runs out of the pure work-tree projection and the attention segment off the existing `showDismissed` option and marks shown dismissed run rows; 01 widens the same `D` toggle's request path so the daemon actually returns dismissed runs to reveal, and fixes `jarvis tui log`'s owner lookup for a dismissed run in the same pass. 01's toggle-widens-both-requests criteria assume 00's projection filter and marker are already in place (they assert on the painted work tree, not just the request), so 00 must land first; 01's own request-shape and log-follow criteria are independently verifiable without 00.

00 reads the intent's "removes a dismissed ad-hoc node with its whole subtree" as per-run removal, not per-invocation removal: a workflow-collapsed node drops only once every member run is dismissed, and a partially-dismissed group instead re-derives its identity and status from its surviving members (see 00's decision ledger). This is a deliberate, defensible reading, not the seed's literal words — flagged here for anyone reviewing this plan against the intent.

Left out of scope: a dismissed *queued* run keeps painting unmarked in the Queue segment regardless of the toggle — that segment reads `state.runs` directly and never joins through the filtered work-tree projection this spec covers (see 00's decision ledger).
