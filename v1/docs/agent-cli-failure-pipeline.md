# Agent CLI failure pipeline

How a vendor CLI invocation becomes an `AgentResult`, then a mode-specific outcome (rotation, fatal stop, or retry). Companion to [Outcome matrix](quota-signals.md#classification-and-fallback-outcome-matrix) and the pattern tables in [`quota-signals.md`](quota-signals.md).

## End-to-end ordering

1. **Harness schedules `agent.run(prompt, opts)`** — Each concrete agent adapter eventually drives `runAgent` in `src/agents/spawn.ts` (argv, cwd, stdio, streaming).
2. **Process completes** — Exit code plus accumulated **stderr** and **stdout** buffers are combined into a single **`diagnostics`** string on non-zero exits (`stderr` then `stdout`).
3. **`AgentResult` from spawn** — On exit `0`: `{ kind: "ok", stdout, stderr }`. On non-zero, **`checkSettlement`** classifies merged **`diagnostics`** (stderr then stdout) **transient → auth → quota → model_config**, else **`kind: "error"`** with `exitCode` and **`stderr` = `diagnostics`**:
   - **transient** — **`isTransientSignal`** → **`kind: "error"`** (step 4 may retry).
   - **auth** — **`isCredentialAuthSignal`** → **`kind: "quota"`** with **`authFailure: true`**.
   - **quota** — **`isQuotaSignal`** (strict per-agent patterns; exit must be non-zero) → **`kind: "quota"`**.
   - **model_config** — **`isModelConfigurationSignal`** (patterns in `src/agents/quota.ts`; opencode uses agent-aware helpers) → **`kind: "model_config"`**. **`weakQuotaPatterns`** / **`weakQuotaExitCodes`** do **not** run in spawn; they apply only inside **`applyQuotaFallbackToAgentResult`** when **`quotaFallback: "lenient"`** and the mode guard allows it (step 5).
   - **Abort:** `opts.signal` can settle early as **`error`** with `stderr` like `aborted: …` (iteration/run timeout or SIGINT path).
4. **Transient retry** — Separate from step 3: when **`runAgent`** gets **`kind: "error"`** from **`singleSpawn`**, if **`isTransientSignal`** still matches and the invocation is not aborted, re-attempt the **same** agent up to **3 re-attempts (4 total spawns)**. Optional `onTransientRetry` per attempt; whole-iteration timeouts accrue. Returns the eventual non-transient result or final `error` at cap.
5. **Mode-specific post-processing** — Callers apply **`applyQuotaFallbackWhenAllowed`** (`src/agents/quota.ts`) where configured:
   - **Plan phases:** porcelain snapshot before/after `agent.run` (`src/modes/plan/git-porcelain.ts`); **`allowLenientWeakQuotaFallback`** is equivalent to unchanged porcelain across that invocation.
   - **Patch (`jarvis run`):** Strict spawn-side **`quota`** is handled **before** lenient fallback. For spawn **`error`**, **`allowLenientWeakQuotaFallback`** is true only when the iteration checked **no** new acceptance criteria **and** the git worktree shows **no** completion-blocking edits (`src/modes/patch/run.ts`).
6. **`emitPlanAgentQuotaFallback`** (draft and intent-split inner loops) — Logs rotation lines when the phase advances after quota or **`model_config`** (`src/modes/plan/emit-plan-quota-stderr.ts`). Uses `plan:` / `intent:` prefixes and harness fallback phrases; the `; falling back` suffix disambiguates rotation from terminal `plan: model configuration error` / `intent: model configuration error` lines in `plan/run.ts` and `intent.ts`.
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
| `src/modes/plan/draft.ts` | Draft phase inner loop over **`modes.plan.agentOrder`**: porcelain guard + **`applyQuotaFallbackWhenAllowed`** + **`emitPlanAgentQuotaFallback`**; **`ok`** → subspec count success; **`quota`** → next agent; **`model_config`** → next agent (rotation stderr via harness fallback line); remaining **`error`** → next agent (hard error does not stop the inner loop); exhaustion returns last result. |
| `src/modes/review/run.ts` | Shared review pass loop (plan + patch): porcelain guard + **`applyQuotaFallbackWhenAllowed`**; **`quota`** rotates within a pass; **`model_config`** → exit `3`; other **`error`** exits that pass (no agent rotation). Agent chain resets each pass. |
| `src/modes/plan/review.ts` | Plan review adapter + **`emitPlanAgentQuotaFallback`** via **`onQuotaRotation`**. |
| `src/modes/patch/review.ts` | Patch review adapter; per-pass timeout in **`loadAgent`**; harness quota stderr via **`onQuotaRotation`**. |
| `src/modes/plan/name-only.ts` | Naming-only phase inner loop (dormant export): porcelain + quota fallback; **`ok`** → return; **`quota`**, **`model_config`**, and **`error`** → next agent; no live operator path today. |

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
