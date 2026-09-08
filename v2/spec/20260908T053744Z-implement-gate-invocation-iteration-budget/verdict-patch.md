Reviewing implementation details to adjudicate the advocate response.
## Verdict

**Fix Claude shell completion before merge.** Subspec 01 requires slot release on the shell-tool **completion frame** and exactly one concurrent gate per daemon process. Three gaps break that for Claude-bound lanes (Cursor-only tests do not exercise them):

1. **`content_block_stop` calls `onAgentShellCommandComplete`** — releases the module slot when JSON assembly ends, not when the Bash subprocess finishes; a second lane can acquire while the first suite still runs.
2. **Every Claude `tool_result` is treated as shell completion** — uncorrelated Read/Grep results can clear `activeGate` and release the slot mid-gate.
3. **Normal `{ kind: "settled" }` iteration exit does not release an acquired slot** — `settleBoundedIteration` only calls `onAgentShellCommandComplete` on interrupt paths; a missed completion frame leaves `agentGateSlotHeld` stuck and refuses all later lanes for the process lifetime.

**Rationale:** These are spec-contract failures on serialization and slot lifecycle, not test-only gaps. Correlate Claude completions to the active shell `tool_use_id` (or equivalent shell-scoped signal); do not treat `content_block_stop` as subprocess completion; ensure slot release on every iteration exit path when a slot was acquired (including successful settle and iteration loss), matching the subspec’s “completion frame or iteration loss” rule.

**Add Claude-path integration coverage.** Extend agents/write-loop tests so premature slot release and stuck-slot behavior fail CI for Claude NDJSON (streaming and non-streaming), not only Cursor frames and mocked `onAgentShellCommand` callbacks.

**Sync `daemon-resume.test.ts` mirrors.** Add `gate_invocation_refused` to the mirrored `WRITE_LOOP_OUTCOME_KINDS` and to the “every reason composing `nextAction: resume` is admitted” `test.each`; resumable gate-only `iteration_timeout` with enriched fields should be covered there or an equivalent end-to-end resume admission test.

**Doc precision (same pass, no behavior change):** Operator-runbook concurrency prose should state codex implements remain unaccounted (per subspec 00), and that refusal aborts the harness invocation after the agent CLI has announced the Bash call — not subprocess prevention. Optionally reconcile plan/intent getting gate machinery vs implement-only docs.

**No actuator change required:**

- **`gate_invocation_refused` without same-iteration checkpoint** — matches subspec 01 terminal contract (“no in-iteration reprompt”).
- **Codex unaccounted** — explicitly in subspec 00 scope; doc caveat only.
- **`workflow-runner-resume.ts` unchanged** — resume admission via `composeRunOperatorError` / `isResumeAdmitted` is sufficient.
- **`intent.md` unchecked ACs** — Jarvis bookkeeping, not a code defect.

**Optional follow-up (not merge-blocking vs completed subspec ACs):** Second full-suite gate in one iteration is silently ignored (`activeGate !== undefined` early-return), allowing within-lane budget bypass; spec did not acceptance-test this shape. Claude stream partial-JSON index resolution via `Map` iteration order is fragile; fix naturally when hardening Claude completion tracking.