# 01 - Refactor v1 agent-adapter tests

## Problem

The agent-adapter tests under `v1/test/agents/` all match `spawn` (and `spawn.test.ts` also
matches `setTimeout`/`sleep`). They exercise CLI-driving adapters; some inject a fake spawn,
some may reach a real process or wall-clock. Apply the 00 triage to this cluster so every file
is deterministic and sandbox-safe, without changing adapter behavior.

Files: `aider`, `claude`, `codex`, `cursor`, `opencode`, `spawn` (`v1/test/agents/*.test.ts`).

## Decisions

- Apply each file's 00 verdict: `already-deterministic` → confirm, no change; `refactor` → route through the injected-spawn seam and any injected clock/poller per `v2/docs/test-writing.md`; `marked-exception` → rename to `.sandbox-unrunnable.test.ts` with a justification comment. Rules out rewriting files the triage cleared.
- Production DI seams are additive optional params defaulting to the real implementation. Rules out altering adapter call sites or default behavior.
- Reuse the existing fake-spawn/poll helpers (`test/setup-fake-agents.ts`, `v1/test/descendant-poll-test-helpers.ts`) rather than adding per-file fakes. Rules out duplicated ad-hoc mocks.

## Task checklist

- [ ] Apply 00 verdicts to each `v1/test/agents/*.test.ts` file.
- [ ] Replace any real spawn/clock/sleep with injected seams; merge/drop redundant cases the triage flagged.
- [ ] Record in `v2/docs/v1-behaviors.md` only a seam that alters an observable default; test-only optional params defaulting to the real impl need no entry.

## Acceptance criteria

- [ ] Every `refactor`-verdict file in `v1/test/agents/` no longer spawns a real OS process or depends on wall-clock/`sleep`; `already-deterministic` files are unchanged; `marked-exception` files are renamed `*.sandbox-unrunnable.test.ts` with a justification comment.
- [ ] The `v1/test/agents/` adapter tests stay green (behavior unchanged by the refactor), run under `bun test --parallel`.
- [ ] No adapter production behavior changes beyond additive, default-preserving DI seams; any seam that alters an observable default is recorded in `v2/docs/v1-behaviors.md` (test-only optional params defaulting to the real impl are not observable and need no entry).
- [ ] `bun run test` and `bun run typecheck` pass.

## Documentation updates

- `v2/docs/v1-behaviors.md`: record any DI seam that alters an observable default, or note none added (additive test-only params defaulting to the real impl are not recorded).
