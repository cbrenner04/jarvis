## Verdict

The classification helpers (`isQuotaSignal`, `isModelConfigurationSignal`, `isTransientSignal`) and the zero-exit quota-envelope check in the shared spawn loop are named as if agent-agnostic but are built entirely from Claude-specific stderr/JSON patterns ported from v1's `quota.ts`. Since `AgentName` currently has only one value (`"claude"`), this causes no functional defect today and the spec correctly scopes classification wiring to `claude` only — no rework of the spawn/classification split is required for this subspec.

**Required outcome:** Add a brief comment at the classification helpers (and/or the quota-envelope check) noting they currently encode Claude-specific patterns and are not yet generalized per-agent — so a future agent-wiring change doesn't inherit these heuristics by accident via `runAgent`/`singleSpawn`. This is a documentation-only fix (a few lines), not a refactor: it must not introduce per-agent parameterization, gating on `config.name`, or any other scope expansion beyond this subspec's `claude`-only wiring.

No other changes required.