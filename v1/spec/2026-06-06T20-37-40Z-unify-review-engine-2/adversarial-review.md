# Adversarial review record — unify review engine

> Persisted review record (committed to history). Captures the adversarial
> review of this spec's implementation so the findings outlive the PR thread.
>
> - PR: #193 — Unify review engine (plan + patch)
> - Reviewed at: 64d0294
> - Date: 2026-06-06
> - Status: advisory — not an acceptance gate; findings tracked below

Verified locally: typecheck clean, 97 review tests pass, no unused imports left in `plan.ts`, timeout watchdog preserved.

## Findings

### 1. [Medium] Raw agent error exit codes propagate and collide with reserved harness codes
The shared runner returns the agent's raw process exit code for a generic error:

```ts
// v1/src/modes/review/run.ts:170
return result.exitCode;
```

Both old implementations always returned **`1`** for an agent error (`patch/run.ts` `else { return 1 }`; plan `result.kind === "error" → return 1`). But the callers re-interpret specific codes as reserved harness meanings:

- `plan.ts`: `reviewResult.exitCode === 2` → `summarizePlan("quota-exhausted")`; `=== 3` → `model-config`.
- `patch`: `reviewExitCode` becomes the process exit code, where `2` = all-agents-quota and `3` = model_config.

So an agent that genuinely fails with exit code `2`, `3`, or `7` is now misclassified — e.g. a real crash exiting `2` is reported as "quota exhausted," or in patch becomes process-exit `7` (blocker). Reachable with the **default config**, since `weakQuotaExitCodes` defaults to `[]` (config.ts:146), meaning no error codes get upgraded to quota first. The shared-runner test (`run.test.ts:256`) pins `errorCode === 9`, locking in raw propagation.

**Suggest:** clamp non-reserved error exit codes to `1` before returning (or have adapters map them), preserving the prior contract and avoiding collision with 2/3/7.

### 2. [Low] Plan summary-reason regression for boundary violations & validation failures
`handleBoundaryViolation` throws `ReviewTerminalError(..., 1)` without invoking `onBlocker`, so `detectedBlocker` stays undefined and `plan.ts` maps `exitCode === 1 → summarizePlan("agent-error")`. Previously:
- write-boundary violations summarized as **`"blocker"`**,
- validation failures summarized as **`"error"`**.

Both now collapse to `"agent-error"`. Behavior (revert, blocker commit, exit 1) is unchanged — only the telemetry/summary reason is miscategorized.

### 3. [Low / confirm intent] Per-pass agent-chain reset
`const remainingAgents = [...agentOrder]` is now inside the pass loop (run.ts:79). Old patch review built the chain once and `shift()`ed permanently, so a quota-exhausted primary stayed dropped for later passes. Now every pass re-tries the primary agent, costing one wasted spawn+quota-failure per subsequent pass when the primary is already exhausted. The commit message ("reset the agent chain each pass") says this is intentional — flagging only to confirm the extra spawns are acceptable.

## What holds up well
- Per-pass timeout/pgid-kill watchdog faithfully preserved via `withReviewPassTimeout` (patch/review.ts:205).
- Telemetry double-record avoided through the `telemetryRecorded` flag on `ReviewTerminalError` + `recordAdapterFailure`.
- Blocker → spec-revert ordering, `.jarvis-review-blocker` consumption, `review: pass N` commits, baseline/final `ready` gates, and plan resume `rK` suffix / no-change skip all carry over. The old `totalPasses` display quirk on resume (`"4/3"`) is fixed to `"4/4"`.
- New porcelain-guarded lenient weak-quota fallback is well-tested.

Net: solid, well-tested refactor. Finding #1 is the one worth addressing before merge — the rest are low-severity categorization nits.
