# Dismiss Pipeline TUI Display

repo: cbrenner04/jarvis

- [ ] [00 - Dismissed pipelines leave the work tree and needs-attention projections](./00-hide-dismissed-pipelines-from-projections.md)
- [ ] [01 - `D` toggles showing dismissed pipelines](./01-show-dismissed-toggle.md)

Scope note: TUI surface only — `v2/src/tui/tui-monitor-pipeline-tree.ts` plus the projections and wiring that read it (`tui-attention-rows.ts`, `tui-monitor-lines.ts`, `tui-monitor-types.ts`, `tui-daemon-client.ts`, `tui-ink-monitor.tsx`, `tui-entry.tsx`). The durable `dismissedAt` column, the store operations, and the `pipeline_dismiss`/`pipeline_undismiss` RPCs with default-excluding `pipeline_list` already landed (`dismiss-pipeline-durable-flag`, `dismiss-pipeline-rpc`); the `pipeline list --all` CLI opt-in is the sibling `dismiss-pipeline-cli` spec. No daemon, store, or CLI change lands here. 00 makes the pure projections hide dismissed pipelines off `TuiMonitorState.showDismissed` (default off, exercised in both positions from state); 01 makes that flag operator-reachable — key binding, control, opt-in `pipeline_list` request, dock hint.
