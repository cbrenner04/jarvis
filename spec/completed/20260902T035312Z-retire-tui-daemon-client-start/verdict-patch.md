Reviewing the implementation against the spec and acceptance criteria to issue an independent verdict.
## Verdict

### Required outcomes

1. **Restore the cross-method error-mapping comment above `daemon error replies reject as RpcError with code and message`.** The subspec task required updating the stale “revision-gated start path” comment, not removing the block. The test still pins three representatives (`health`, `pause`, `resume`); a short comment should state that daemon error frames map uniformly to `RpcError` and name those categories. Without it, an explicit task item is incomplete and future readers lose the rationale for keeping three distinct RPC shapes in that test.

### Not required

- **Compile-time `start` absence pin** — Property access with `@ts-expect-error` on `TuiDaemonClient` satisfies the acceptance criteria’s “or equivalent” wording and catches reintroduction of a required or optional `start` member (unused directive fails typecheck). Tightening to a call expression is optional polish, not a blocker.
- **`parseStartResult` diversity in the error-mapping test** — Per the decision ledger, `resume` is the intended third representative; other parsers remain covered elsewhere in the same file.
- **Dock admission negative assertion in the client unit test** — Pipeline admission is owned and tested in `tui.test.ts`; daemon IPC `start` and TUI `pipeline_start` admission are correctly left untouched.
- **`resume` folded into `okRunRpc`** — Behavior-preserving consolidation; existing happy-path coverage for `resume` is unchanged.
- **Pre-existing `as TuiDaemonClient` casts in `tui-entry.test.tsx`** — Out of subspec scope; typecheck passes after stub removal.
- **`daemon-host.md` scope** — The documented contradiction is fixed; broader cross-doc edits were not required.
- **`intent.md` documentation drift** — Superseded by the completed subspec; not an implementation defect for the actuator.