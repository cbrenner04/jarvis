---
name: prompt-mode-agent-fallback
---

# `jarvis prompt` should cycle through configured agents

`jarvis1 prompt` is documented as a single-pass prompt mode that tries
`modes.prompt.agentOrder` in order until one agent succeeds. In practice it
appears to stop after the first quota-classified agent result, so a configured
fallback like `claude -> codex -> cursor` does not get a chance to handle the
same prompt.

The behavior should match the operator expectation and existing docs: prompt
mode sends the same rendered prompt to each configured agent in order when the
previous agent is unavailable because of quota or another fallback-eligible
condition. It should only report all-agents quota exhaustion after every
configured agent has returned quota. A successful later agent should continue
through the normal prompt-mode no-diff or diff/commit/PR flow.

Current code to inspect:

- `v1/src/modes/prompt/run.ts`: loads `cfg.modes.prompt.agentOrder`, loops over
  agents, applies `applyQuotaFallbackWhenAllowed`, but the `result.kind ===
  "quota"` branch sets `all-agents-quota` and breaks immediately.
- `v1/docs/specless-prompt.md`: already says prompt mode tries agents in
  configured order and shares quota fallback behavior.
- `v1/test/modes/prompt/run.test.ts`: currently only tests helper logic, not
  the command's agent-order behavior.

Desired operator behavior:

- With prompt order `[claude, codex]`, if `claude` returns strict quota and
  `codex` succeeds without diffs, `jarvis1 prompt "..."` exits 0 and prints
  `codex`'s stdout.
- With prompt order `[claude, codex]`, if both return quota, the command exits
  2 and emits an all-agents quota message only after trying both.
- With prompt order `[claude, codex]`, if `claude` returns a model-config error
  or a generic hard failure, preserve the intended documented policy rather
  than silently treating every failure as a fallback. If the docs and current
  code disagree, make the policy explicit in code tests and docs.
- Telemetry for prompt mode should identify the terminal agent/outcome clearly
  enough to understand whether fallback happened. Do not invent a broad
  telemetry redesign unless the current row cannot represent the terminal
  result.

Implementation notes:

- Keep prompt mode single-pass: fallback attempts are retries of the same prompt
  inside one command invocation, not extra Jarvis iterations.
- Reuse the same quota classification helpers and stderr language where
  practical so patch/plan/prompt logs stay consistent.
- Avoid duplicating the full patch-mode loop. A small shared helper is fine only
  if it reduces real duplication without changing patch behavior.

Acceptance criteria for the eventual spec:

- A Bun test drives `promptCommand` (or the smallest practical harness around
  it) with two fake configured agents where the first returns quota and the
  second succeeds; it proves both agents are invoked in order and the command
  returns success using the second agent's output.
- A Bun test covers all configured prompt agents returning quota and proves the
  command returns exit code 2 only after trying each configured agent.
- Existing prompt-mode no-diff and diff/commit/PR behavior still works for a
  successful first agent and a successful fallback agent.
- Prompt-mode docs state the exact fallback policy for quota, model-config, and
  generic errors, and match the implemented behavior.
- `bun run typecheck` and the relevant Bun tests pass.

## Refinement

- Fallback-eligible result kinds are exactly `quota` and `model_config`; a generic `error` (and `watchdog` timeout) halts the chain immediately on the failing agent (exit 3 / exit 8). The quota fix must change only the `quota` branch from break→continue, not convert every non-`ok` result to a retry. Rules out: making all non-success results fall through to the next agent, which would silently mask real per-agent failures.
- The post-loop terminal exit is computed from tracked state "did any attempted agent fail for a non-quota reason," NOT "was a quota result ever seen." All-quota chain → exit 2 (`all-agents-quota`, `telemetryKind=quota`); a chain with no success where at least one agent fell through for a non-quota reason (e.g. `model_config → quota`, or all `model_config`) → exit 3, `telemetryKind=error`, `exitReason=agent-failure`. Rules out: tracking "quota seen" and emitting exit 2 on a `model_config → quota` chain (last-write-wins would wrongly record `quota`).
- This terminal computation replaces both the in-loop `exitCode = 2` assignment and the post-loop `if (!agentSuccess || !agentUsed) return 3`. Once the quota branch is `continue`, nothing sets exit 2 in-loop, so without this change the all-quota chain falls through to the generic `return 3` and silently breaks the exit-2 criterion. Rules out: leaving the existing generic post-loop return to catch the all-quota case.
- Per-agent quota fallthrough emits the shared harness rotation line (`<agent>: harnessQuotaFallbackLenientLine(exitCode)`) plus the raw `result.stderr` (augment, not replace); exhaustion emits `HARNESS_ALL_AGENTS_QUOTA_EXHAUSTED` before exit 2 — matching patch-mode emission in `v1/src/modes/patch/run.ts` for the stated log-consistency goal. Rules out: keeping prompt's current raw-stderr-only quota output, which diverges from patch/plan logs.
- Terminal-agent and `configured_model` telemetry state must update on every attempt, including each quota `continue`, so the single-row all-quota telemetry names the last attempted agent. Rules out: recording `agentUsed` only on success/break, which leaves the all-quota row reporting `unknown`.
- Telemetry stays one row per command capturing the terminal agent + outcome; intermediate fallback attempts remain stderr-only (matching current design). Do not add per-attempt rows. Rules out: a telemetry redesign — the existing row already represents the terminal result, which the intent scopes out.

