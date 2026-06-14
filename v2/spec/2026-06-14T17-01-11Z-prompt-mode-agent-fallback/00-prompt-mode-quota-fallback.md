# Prompt mode quota fallback

## Problem

`promptCommand` (`v1/src/modes/prompt/run.ts`) loops `cfg.modes.prompt.agentOrder`
but the `result.kind === "quota"` branch (run.ts:233-240) sets exit 2 /
`all-agents-quota` and `break`s on the **first** quota result. A configured
fallback like `claude → codex → cursor` never reaches the later agents when the
first is quota-limited. Docs (`v1/docs/specless-prompt.md`) already promise
order-fallback, so code disagrees with documented behavior.

Patch mode already has the correct shape: quota → continue to next agent,
emit terminal exhaustion only when no agent is left. Prompt mode also lacks the
`agents` override seam patch mode uses (`buildActiveAgents`, run.ts:517), so its
agent-order behavior is currently untestable.

## Decisions

- `quota` branch changes break→continue; only `quota` (not all non-`ok` kinds) gains fallthrough. Rules out: converting `model_config`/`error`/`watchdog` to retries, masking real per-agent failures.
- Terminal exit 2 (`all-agents-quota`) fires only when every attempted agent returned `quota`. A chain with no success but ≥1 `model_config` fallthrough exits 3. Rules out: exit-2/all-agents-quota on a mixed chain where a non-quota failure occurred.
- Generic `error` exits 3 and `watchdog` exits 8, halting the chain immediately on the failing agent (unchanged). Rules out: letting hard failures fall through to the next agent.
- Add `agents?: Partial<Record<AgentName, Agent>>` to `PromptRunOptions`, applied like patch mode's `buildActiveAgents`. Rules out: testing agent order via fake binaries on PATH or leaving it untested.
- Reuse `quota-harness-messages.ts`: per-agent quota fallthrough emits the shared lenient rotation line plus raw agent stderr; terminal exit-2 emits `HARNESS_ALL_AGENTS_QUOTA_EXHAUSTED`. Rules out: bespoke prompt-only quota strings or dropping diagnostic stderr.
- Telemetry stays one row capturing the last attempted agent/configured model and terminal outcome; intermediate fallback attempts remain stderr-only. Rules out: per-attempt telemetry rows or a redesign the intent scopes out.

## Task checklist

- Change the `quota` branch to update terminal-agent/model state, emit raw stderr plus the shared rotation line, and continue.
- Replace the existing in-loop exit-2 assignment and generic post-loop `return 3` with terminal logic: exit 2 + `HARNESS_ALL_AGENTS_QUOTA_EXHAUSTED` only if every attempted agent returned quota; otherwise exit 3.
- Track whether any non-quota fallthrough occurred, not whether quota was seen.
- Set `telemetryKind`/`exitReason` to match the terminal outcome: all-quota → `quota`/`all-agents-quota`; mixed or all-`model_config` with no success → `error`/`agent-failure`.
- Add the `agents` override to `PromptRunOptions` and apply it when building the agent list.
- Replace helper-only tests in `v1/test/modes/prompt/run.test.ts` with tests driving `promptCommand` against fake agents in a temp git repo (mirror `v1/test/run.test.ts` setup; use `skipGhCheck`).
- Update docs.

## Acceptance criteria

- [ ] A Bun test drives `promptCommand` with prompt order `[claude, codex]` where `claude` returns `quota` and `codex` returns `ok` with no diffs; it asserts both agents were invoked in order, exit code is `0`, and `codex`'s stdout was printed.
- [ ] A Bun test with prompt order `[claude, codex]` where both return `quota` asserts both agents were invoked and exit code is `2`, with the shared all-agents-quota stderr emitted only after the second agent.
- [ ] A Bun test proves a successful first agent still drives both the no-diff (stdout printed, no commit) and diff (commit + push + PR) flows; a successful fallback agent (first quota, second ok) drives the diff flow identically.
- [ ] A Bun test with prompt order `[claude, codex]` where `claude` returns `model_config` and `codex` returns `quota` (no success) asserts exit code `3`, not `2`.
- [ ] A Bun test asserts a generic `error` from the first agent halts the chain (exit `3`) without invoking the second agent.
- [ ] `bun run typecheck` and `bun test v1/test/modes/prompt/run.test.ts` pass.

## Documentation updates

- `v1/docs/specless-prompt.md`: state the exact fallback policy — `quota` and `model_config` are fallback-eligible (try next agent); generic `error` (exit 3) and timeout (exit 8) halt immediately; exit 2 only when every agent returned quota, exit 3 when a non-quota fallthrough ended the chain. Correct the single-pass section that implies first-success-only.
- `v2/docs/v1-behaviors.md`: update the prompt fallback entry (line ~94) to record per-agent quota fallthrough and the all-quota-vs-mixed exit-2/exit-3 distinction; confirm telemetry stays one terminal row (line ~98).
