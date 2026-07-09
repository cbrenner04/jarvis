# 00 - TUI monitor types and daemon client

Trim doc-comments in `v2/src/tui/tui-monitor-types.ts` and `v2/src/tui/tui-daemon-client.ts` to `v2/docs/documentation-standard.md`'s inline tiering: no comment when evident from name+type, one-liner for one non-obvious fact, full block only for genuinely non-obvious contracts.

## Decisions

- Zero behavior or signature changes; comments only.
- `TuiMonitorControls` methods (`pauseSelected`, `resumeSelected`, `killSelected`, `approveSelected`, `reviseSelected`) each carry a near-identical multi-line block repeating "no selection -> inline `no run selected`" and the failure-surfacing rule; collapse to one type-level sentence on `TuiMonitorControls` plus per-method one-liners only for what differs (which daemon RPC, which decision value).
- `TuiDaemonClient`'s `pause`/`resume`/`kill` each restate `@throws {RpcError}` / `@throws {RpcConnectionError}` already covered by the type-level doc-comment on `TuiDaemonClient`; drop the per-method `@throws` tags and keep only what's non-obvious per method (which rejection codes apply).
- Keep `connectTuiDaemon`'s contract block — it names a real thrown error condition not evident from the signature.

## Task checklist

- [ ] Collapse repeated inline-error narration across `TuiMonitorControls` methods into one type-level sentence.
- [ ] Drop per-method `@throws` blocks on `TuiDaemonClient.pause`/`resume`/`kill` that restate the type-level note; keep only non-obvious per-method facts.
- [ ] Re-check every remaining comment in both files against the tiering rule (evident/one-liner/full-block); trim or leave per that judgment.

## Acceptance criteria

- [x] `bun run typecheck` passes with no signature changes in either file.
- [x] `v2/src/tui/tui-daemon-client.test.ts` stays green (behavior unchanged).
- [x] No comment in either file restates a type already expressed in the signature.
- [x] `git diff` scoped to `tui-monitor-types.ts` and `tui-daemon-client.ts` touches only comment/whitespace lines.
- [x] `connectTuiDaemon`'s contract block is present, unmodified.

## Documentation updates

None — comments-only change, no operator-facing or cross-file behavior changed.
