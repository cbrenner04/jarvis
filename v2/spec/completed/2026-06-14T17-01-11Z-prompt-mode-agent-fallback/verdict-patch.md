## Verdict

### Required

1. **`v2/docs/v1-behaviors.md` must match terminal prompt telemetry.** The prompt telemetry bullet still lists `model_config` as a terminal exit reason. After this change, terminal exhaustion without success records `telemetryKind: "error"` and `exitReason: "agent-failure"` for both mixed chains (`model_config` → `quota`) and all-`model_config` chains. The behaviors doc was in scope for this subspec and must describe actual terminal values, not pre-change semantics.

2. **Remove the unrelated `env: process.env` on `gh pr create`.** That hunk is outside the quota-fallback spec. `execFileSync` already inherits the process environment by default; the change adds review noise and couples an orthogonal behavior fix to this branch.

3. **Quota fallthrough tests must assert raw agent stderr is emitted.** The spec requires per-agent quota fallthrough to emit the shared rotation line **and** raw agent stderr. Existing tests check harness constants but not agent diagnostic text (e.g. `"limit"`). Add a minimal assertion on an existing quota-fallthrough test so the stderr contract has regression coverage.

### Rationale

All six acceptance criteria are met; core fallback logic (quota `continue`, all-quota vs mixed exit 2/3, harness messages, `agents` override, integration tests) is correct. Remaining gaps are doc accuracy on a file this subspec explicitly required updating, scope discipline on an unrelated diff hunk, and one untested behavior the spec decisions pin but acceptance criteria did not spell out.

### Not required on this branch

- `quota-signals.md` prompt coverage or grep-contract updates (not in subspec documentation list).
- Telemetry-row assertions, lenient weak-quota, watchdog, 3+ agent, all-`model_config`, or attribution tests (outside acceptance criteria; reasonable follow-ups).
- Pre-existing lock-busy exit-code doc drift (`9` vs `1`).
- Shared `buildActiveAgents` extraction or post-loop terminal-exit refactoring (style/maintainability only).
