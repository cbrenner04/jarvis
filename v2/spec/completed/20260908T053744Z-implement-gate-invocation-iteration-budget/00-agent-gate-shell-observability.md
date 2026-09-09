# 00 - Agent gate shell observability

## Primary implementation surface

execution-loop — shell-command observability seam, gate-invocation classification, and per-iteration active-gate tracking wired from `v2/src/execution/write-loop.ts` through `shared/invocation/agents.ts`

## Problem

`write-loop.ts` drives opaque agent CLIs through `shared/invocation/agents.ts`; nothing surfaces the agent's inner shell commands to the loop. Budget preflight, cross-lane serialization, active-gate timeout enrichment, and gate-only resumability all presuppose observing `bun run test:*` before the suite starts — that seam does not exist.

## Decision ledger

- **Observability seam:** optional `onAgentShellCommand` on `InvocationBinding.invoke` args; `singleSpawn` in `shared/invocation/agents.ts` incrementally parses NDJSON stdout for per-agent shell-tool frames and invokes the callback synchronously with the extracted command string as each frame arrives; implement write-loop passes the callback on each iteration invocation; rules out PATH wrapper shims (install surface, cross-language), post-hoc process polling (misses the refusal window), and write-loop-only stream parsing (duplicates per-agent frame knowledge).
- **Agent scope:** claude and cursor bindings already run with `--output-format stream-json` and get frame parsing; codex's binding (`runCodexBinding`) emits no live structured stream today — only a post-hoc session rollout file read after the invocation settles — so a codex-bound iteration observes no shell commands and this subspec's tracking/classification is a no-op for it, falling back to today's unaccounted behavior; rules out bundling a codex live-stream transport change (`--json`/rollout tailing) into this budget-accounting spec.
- **Gate-invocation detection:** classify a callback command as a full-suite gate invocation when it matches `/^bun run test(?::|$)/` — export `isReadyTestCommand` from `ready-finalize.ts` (or move to a shared helper both import); rules out treating typecheck, file-scoped `bun test`, or git work as gate traffic.
- **Active-gate tracking:** per implement iteration, write-loop records `{ command, startedAtMs }` from the first classified gate callback until the matching shell-tool completion frame (or iteration loss); rules out inferring active gate state only from iteration timeout without a classified start.
- Deferred to first consumer: exact per-agent (claude/cursor) shell-tool JSON field paths — pin when each adapter's frame is first exercised in tests.

## Tasks

- Add `onAgentShellCommand?: (command: string) => void | Promise<void>` to `InvocationBinding.invoke` args and `executeWithQuotaFallback` forwarding in `shared/invocation/execute.ts`.
- Parse shell-tool NDJSON frames in `singleSpawn` stdout handling for the claude and cursor bindings; invoke `onAgentShellCommand` on frame start and clear active-gate tracking on frame completion. Codex's binding is untouched.
- Export `isReadyTestCommand` (or shared equivalent) from `ready-finalize.ts`; use it in the write-loop gate callback.
- Wire implement `executeWriteLoop` iterations to pass `onAgentShellCommand`, classify gate commands, and maintain per-iteration active-gate state (`command`, `startedAtMs`).
- Add `agents.test.ts` frame-parser coverage and `write-loop.test.ts` end-to-end proof that a gate shell command is observed and classified; add `// @mutate` on the shell-frame parser or callback wiring.
- Document the callback seam in `v2/docs/shared-invocation.md`.

## Acceptance criteria

- [x] `write-loop.test.ts` proves an implement iteration observes a gate shell command through `onAgentShellCommand`, classifies it via `isReadyTestCommand`, and records active-gate state; it fails against the current opaque agent invocation reachable on main.
- [x] `v2/docs/shared-invocation.md` documents `onAgentShellCommand`, that it fires for claude/cursor only (codex has no live structured stream and is unaffected), and that it fires as the agent CLI announces the tool call, at or just before execution.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.

## Documentation updates

- `v2/docs/shared-invocation.md` — `onAgentShellCommand` callback, claude/cursor-only scope, shell-tool frame parsing, timing.
