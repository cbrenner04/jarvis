## Verdict

### Required: operator documentation must be internally consistent

1. **`v2/docs/operator-runbook.md` Status preamble** must no longer tell operators to bounce after any v2 merge or reference the docs-only dispatch-halt seed (`daemon-runs-stale-code-until-restarted`). It must state digest-based bounce rules: non-executable merges (`v2/spec/**`, `v2/docs/**`, etc.) need no bounce; merges touching `v2/src/**`, `shared/**`, or repo manifests still require idle bounce or live-run refusal. This is an explicit acceptance criterion and currently contradicts the correct rule already recorded later in the same file.

2. **`v2/docs/operator-runbook.md` revision-mismatch trap** (work-dispatch “Two traps” section) must describe bounce/refusal on **executable-tree digest mismatch**, not undifferentiated HEAD/revision mismatch. TUI behavior must match the same digest contract.

3. **`v2/docs/write-behavior.md`** must align with the shipped guard: `jarvis daemon status` stale/running is digest-based (HEAD may differ after docs-only merge); work-dispatch guards compare executable digests; digest match with HEAD drift advances `loadedRevision` in-process without bounce; genuine executable-tree mismatch preserves auto-bounce, live-run refusal, and `--no-auto-bounce` refusal. `daemon-host.md` defers operator CLI semantics here — leaving HEAD-only language creates a second durable home that disagrees with the updated docs.

### Required: advance contract must be directly tested

4. **Docs-only dispatch regressions** must assert the advance contract from acceptance criterion #2: guarded `status` is invoked with `{ currentRevision, currentExecutableDigest }`, and the returned `loadedRevision` advances from the pre-merge HEAD to the invoking HEAD before the mutating `start`/`resume`/`workflow` RPC is sent. Today tests only prove no bounce and successful dispatch.

5. **`advanceLoadedRevision`** must have focused unit coverage pinning: digest match + HEAD drift → advance; digest mismatch → no advance; missing/invalid params → no advance. This closes the gap left by removing `dispatch-revision.test.ts` and guards the shared daemon/mock contract without a full daemon boot.

### Not required

- TUI-specific docs-only regression (shared `dispatchRevisionMismatch` path; subspec did not require it).
- Per-path runtime classification in production (`requiresDaemonBounceForChangedPath` as fixture/spec artifact is sufficient).
- Machine profiles, prompts, `jarvis write` bypass, error-string polish, or intent.md checkbox housekeeping.

### Rationale

Core digest gating, preserved bounce/refusal for real code changes, and test/typecheck green status satisfy the behavioral design. Remaining gaps are **incomplete doc alignment** (explicit subspec acceptance criteria; `write-behavior.md` is an undeclared but required home per doc placement) and **thin advance-contract tests** (acceptance criterion #2 is implied by mocks but not asserted). Fix those before treating the patch complete.
