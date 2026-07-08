**Verdict: one required outcome.**

- Seed 02 (`v2/spec/seeds/02-v2-dead-weight-purge.md`) must have the eight symbols this spec de-exports (`cli.ts Io`; `agent-model-config EXECUTABLE_ROLES`, `ExecutableRole`; `testing/bindings SimulatedOutcome`; `tui TuiDaemonHealthResult`, `TuiDaemonStatusResult`, `TuiDaemonStartResult`, `TuiDaemonRpcTransport`) removed from its De-export bullet's symbol list.

**Why:** This spec's own Decisions section asserts "seed 02 omits these eight symbols from its de-export list," but the landed diff to seed 02 only dropped the unrelated `ipc.test.ts` duplicate-test bullet — the De-export bullet's symbol list is untouched and still contains all eight. The spec's stated coordination outcome was not actually executed, leaving a stale/false cross-spec contract that would cause seed 02 to redundantly re-target already-de-exported symbols.

No other findings — the implementation itself (five source diffs, `export-surface-trim.test.ts` guard, checkbox-only spec edits) is correct and matches the plan verdict's requirements.