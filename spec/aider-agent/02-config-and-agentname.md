# 02 — Config and AgentName expansion

## Problem

`AgentName` is a closed union (`"claude" | "codex" | "cursor" | "opencode"`)
used to type every place agents are referenced — including
`modes.{patch,plan}.agentOrder` entries in `src/config.ts`, the
`makeAgent` factory in `src/modes/patch/run.ts`, the plan-mode agent
factories in `src/modes/plan/draft.ts` and `src/modes/plan/review.ts`,
and the per-agent branches in `src/agents/quota.ts`. Adding aider means
expanding that union in every location it is declared and handling
`"aider"` in every exhaustive switch.

## Decisions

- `AgentName` is declared in **two** places that must stay in sync:
  - `src/agents/types.ts` line 1.
  - `src/config.ts` (the `AGENT_NAMES` const and derived `AgentName`
    type, currently around lines 68–69).

  Both must be updated to include `"aider"`. The validator's
  `isAgentName` check (`config.ts`) derives from `AGENT_NAMES`, so the
  config side is the single source of truth for what is accepted in
  `agentOrder` entries.
- Config v2 has **no `patchModels` map**. Each entry in
  `modes.patch.agentOrder` / `modes.plan.agentOrder` carries its own
  `model`. Aider is opted in by adding
  `{ "agent": "aider", "model": "<...>" }` to one of those arrays in
  `~/.jarvis/config.json` — there is no dedicated `jarvis config`
  subcommand for editing the order, so this subspec adds none.
- Default `modes.{patch,plan}.agentOrder` is **unchanged**. Aider is not
  in the default order; users opt in by editing config.
- `DEFAULT_AGENT_MODELS` (used to keep `Record<AgentName, string>`
  exhaustive) gains an `aider` entry. Pick a sensible placeholder —
  recommend `"ollama/llama3.1:8b"` since Ollama is the worked example in
  subspec 04. This is not enforced anywhere at run time; it's just the
  exhaustiveness fill-in.
- The agent factories in `src/modes/patch/run.ts` (`makeAgent`),
  `src/modes/plan/draft.ts`, and `src/modes/plan/review.ts` each contain
  a `switch (name)` over `AgentName`. Each must gain an `"aider"` case
  that constructs `new AiderAgent({ model })`.
- `validateAgentOrder` in `src/config.ts` already enforces unique agent
  names, non-empty model strings, and rejects unknown agents via
  `isAgentName`. No new validation code is needed beyond extending the
  union — adding `"aider"` to `AGENT_NAMES` automatically allows it in
  the existing per-entry validator, with the same duplicate /
  empty-model / unknown-agent error paths existing agents get.
- Aider does **not** need a per-agent block under
  `modes.{patch,plan}.agents` (unlike `claude.outputFormat`). If a
  future change adds aider-specific config it can be added there; this
  subspec does not.

## Tasks

- [ ] Add `"aider"` to `AgentName` in `src/agents/types.ts`.
- [ ] Add `"aider"` to the `AGENT_NAMES` tuple in `src/config.ts` so the
      derived `AgentName` type and `isAgentName` validator both accept
      it.
- [ ] Add `aider: "ollama/llama3.1:8b"` (or another sensible
      placeholder) to `DEFAULT_AGENT_MODELS` in `src/config.ts` to keep
      the `Record<AgentName, string>` exhaustive.
- [ ] Extend the `makeAgent` switch in `src/modes/patch/run.ts` with an
      `"aider"` case returning `new AiderAgent({ model })`. Import
      `AiderAgent` from `../../agents/aider.ts`.
- [ ] Extend the equivalent switches in `src/modes/plan/draft.ts` and
      `src/modes/plan/review.ts` the same way.
- [ ] Search for any other exhaustive `switch (name)` or
      `case "opencode"` sites that the compiler now flags and add the
      `"aider"` branch (e.g. attribution / logging helpers).
- [ ] Add tests for:
      - A config with `modes.patch.agentOrder` containing an `aider`
        entry validates successfully.
      - A config with two `aider` entries in the same `agentOrder`
        fails with the existing duplicate-agent error.
      - A config with `{ "agent": "aider", "model": "" }` fails with the
        existing empty-model error.
      - The patch-mode factory returns an `AiderAgent` instance for an
        `{ agent: "aider", model: "..." }` entry.

## Acceptance criteria

- [ ] `bun run typecheck` passes — every exhaustive switch over
      `AgentName` now also handles `"aider"`.
- [ ] `bun test` passes including the new cases.
- [ ] `bun run check` passes.
- [ ] A config file with
      `{"agent": "aider", "model": "ollama/llama3.1:8b"}` in
      `modes.patch.agentOrder` loads without error.
- [ ] The patch-mode factory returns an `AiderAgent` instance for that
      entry (verified by the factory test).
- [ ] Default config produced by `loadConfig` on a fresh
      `~/.jarvis/config.json` still has the pre-existing
      `modes.{patch,plan}.agentOrder` and does **not** include `aider`.

## Documentation updates

- None. Subspec 04 handles README/docs updates.
