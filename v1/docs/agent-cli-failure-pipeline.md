# Agent CLI failure pipeline

How a vendor CLI invocation becomes an `AgentResult`, then a mode-specific outcome (rotation, fatal stop, or retry). Companion to [Outcome matrix](quota-signals.md#classification-and-fallback-outcome-matrix) and the pattern tables in [`quota-signals.md`](quota-signals.md).

## End-to-end ordering

1. **Harness schedules `agent.run(prompt, opts)`** — Each concrete agent adapter eventually drives `runAgent` in `src/agents/spawn.ts` (argv, cwd, stdio, streaming).
2. **Process completes** — Exit code plus accumulated **stderr** and **stdout** buffers are combined into a single **`diagnostics`** string on non-zero exits (`stderr` then `stdout`).
3. **`AgentResult` from spawn** — On exit `0`: `{ kind: "ok", stdout, stderr }`. On non-zero:
   - **Classification order:** `model_config` (patterns in `src/agents/quota.ts`; opencode uses agent-aware model-config helpers) → **`quota`** if **`isQuotaSignal`** matches **strict** per-agent stderr patterns (exit code must be non-zero) → otherwise **`error`** with `exitCode` and **`stderr` set to `diagnostics`** (merged streams). **`weakQuotaPatterns`** / **`weakQuotaExitCodes`** do **not** run in spawn; they apply only inside **`applyQuotaFallbackToAgentResult`** when **`quotaFallback: "lenient"`** and the mode guard allows it (step 4).
   - **Abort:** `opts.signal` can settle early as **`error`** with `stderr` like `aborted: …` (iteration/run timeout or SIGINT path).
4. **Transient retry** (new) — When **`runAgent`** settles on **`kind: "error"`** (after classification order above), if **`isTransientSignal`** matches (connection closed, broken pipe, HTTP 502/503/504, etc.) and the invocation is not aborted, spawn re-attempts the **same** agent up to a fixed cap of **2 re-attempts (3 total spawns)**. Fires optional `onTransientRetry` callback per attempt before re-spawn; whole-iteration timeouts accrue across all attempts. Returns the eventual non-transient result or the final `error` at cap.
5. **Mode-specific post-processing** — Callers apply **`applyQuotaFallbackWhenAllowed`** (`src/agents/quota.ts`) where configured:
   - **Plan phases:** porcelain snapshot before/after `agent.run` (`src/modes/plan/git-porcelain.ts`); **`allowLenientWeakQuotaFallback`** is equivalent to unchanged porcelain across that invocation.
   - **Patch (`jarvis run`):** Strict spawn-side **`quota`** is handled **before** lenient fallback. For spawn **`error`**, **`allowLenientWeakQuotaFallback`** is true only when the iteration checked **no** new acceptance criteria **and** the git worktree shows **no** completion-blocking edits (`src/modes/patch/run.ts`).
6. **`emitPlanAgentQuotaFallback`** (plan only) — Logs rotation lines after quota fallback (`src/modes/plan/emit-plan-quota-stderr.ts`).
7. **User-visible outcome** — Harness stderr banners, continuation vs return, telemetry (`writeTelemetry` in patch), and process exit codes follow the outcome matrix in `docs/quota-signals.md`.

### Legacy field naming

On non-zero exits, **`AgentResult.stderr`** often holds **merged stderr + stdout** (`diagnostics`). The field name predates that merge; treat it as “CLI diagnostics,” not strictly stderr-only.

## `agent.run` callsite inventory

Audit command used when this doc was written:

```bash
rg '\bagent\.run\(' src --glob '*.ts' -l
```

### Harness (`src/`)

| Module | Role |
| --- | --- |
| `src/modes/patch/run.ts` | Single-agent patch iteration: timeouts/SIGINT handling on **`error`**; **`ok`** → progress/completion logic; spawn **`quota`** → rotate `activeAgents`; **`model_config`** → fatal; spawn **`error`** → **`applyQuotaFallbackWhenAllowed`** then quota rotation or fatal **`error`**. |
| `src/modes/plan/draft.ts` | Draft phase inner loop over **`modes.plan.agentOrder`**: porcelain guard + **`applyQuotaFallbackWhenAllowed`** + **`emitPlanAgentQuotaFallback`**; **`ok`** → subspec count success; **`quota`** → next agent; **`model_config`** → fatal; remaining **`error`** → next agent (hard error does not stop the inner loop); exhaustion returns last result. |
| `src/modes/review/run.ts` | Shared review pass loop (plan + patch): porcelain guard + **`applyQuotaFallbackWhenAllowed`**; **`quota`** rotates within a pass; **`model_config`** → exit `3`; other **`error`** exits that pass (no agent rotation). Agent chain resets each pass. |
| `src/modes/plan/review.ts` | Plan review adapter + **`emitPlanAgentQuotaFallback`** via **`onQuotaRotation`**. |
| `src/modes/patch/review.ts` | Patch review adapter; per-pass timeout in **`loadAgent`**; harness quota stderr via **`onQuotaRotation`**. |
| `src/modes/plan/name-only.ts` | Naming-only phase inner loop: porcelain + quota fallback; **`ok`** → return; **`quota`** → next agent; **`model_config`** → fatal; **`error`** → next agent. |

### Tests (`test/`)

Agent adapters are exercised via **`agent.run`** in:

- `test/agents/claude.test.ts`
- `test/agents/codex.test.ts`
- `test/agents/cursor.test.ts`
- `test/agents/opencode.test.ts`

(Re-audit with `rg '\bagent\.run\(' test --glob '*.ts' -l` when adding agents or harness paths.)

## Extension points (where to change behavior)

| Concern | Location |
| --- | --- |
| Merge policy + spawn classification order | `src/agents/spawn.ts` |
| Transient signal detection + retry cap + re-entry safety | `src/agents/spawn.ts` (`isTransientSignal`, retry loop, cap constant), `src/agents/quota.ts` (`isTransientSignal` patterns), mode callbacks for re-entry cleanup (`onSpawned` re-entry safety) |
| Strict / weak quota patterns, weak exit codes, lenient upgrade | `src/agents/quota.ts` (`applyQuotaFallbackWhenAllowed`, `isWeakQuotaSignal`, pattern lists) |
| Plan porcelain guard | `src/modes/plan/git-porcelain.ts` |
| Patch no-progress guard inputs | `src/modes/patch/run.ts` (criteria diff + `worktreeCompletionBlocker`) |
| Operator-facing rotation strings | `src/quota-harness-messages.ts`, `src/modes/plan/emit-plan-quota-stderr.ts` |
| Patch transient retry harness line | `src/quota-harness-messages.ts` (`harnessTransientRetryLine`), `src/modes/patch/iteration.ts` (`onTransientRetry` callback) |
