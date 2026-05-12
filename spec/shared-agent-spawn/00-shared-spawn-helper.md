# 00 — Shared spawn helper and agent migration

## Problem

`ClaudeAgent`, `CodexAgent`, `CursorAgent`, and `OpencodeAgent` each implement
nearly identical process lifecycle code: `spawn` with `cwd`, collect
stdout/stderr, guard null streams, settle exactly once, on non-zero exit combine
streams for diagnostics, then classify with `isModelConfigurationSignal` and
`isQuotaSignal` from `src/agents/quota.ts` before returning a generic error.

Only the **spawn shape** differs meaningfully: argv construction, `stdio` (stdin
piped for prompt vs ignored when the prompt is positional), writing the prompt
to stdin when applicable, and the per-agent label in the “failed to open child
process streams” message.

## Decisions

- Use a **shared function** (composition), not a class hierarchy. Keep each
  `*Agent` class as the public `Agent` implementation with a thin `run` method
  that delegates to the helper.
- Add **one new module** under `src/agents/` (exact filename left to the
  implementer) that owns the duplicated loop. It should accept everything needed
  to preserve current behavior, including:
  - `name: AgentName` for quota and model-config classification.
  - Binary command and argv (or a callback that builds argv from `prompt` and
    `AgentRunOptions` so `--add-dir` and similar stay in the agent module).
  - Explicit control over **`stdio`** so Claude/Codex (stdin pipe + write) stay
    distinct from Cursor/Opencode (stdin ignored).
  - A short **stream error prefix** (e.g. `claude:`) for the null-stream error
    message, matching today’s strings.
- **Do not** change `Agent`, `AgentRunOptions`, `AgentResult`, or public exports
  consumed by `src/commands/run.ts` except what is strictly required for typing
  the helper (prefer keeping types in the new module or `types.ts` only if
  needed).
- **Classification rules** must stay aligned with `quota.ts`:
  - `isModelConfigurationSignal` may be called with one or two arguments
    depending on agent (`opencode` uses the overload that includes opencode-only
    patterns). The helper must not drop that distinction.
  - Order of checks on non-success exit: model configuration → quota → generic
    error, unchanged from current agents.
- Keep per-agent **file headers** (permission posture, CLI invocation notes)
  intact; only refactor structure inside `run` unless a one-line note pointing
  at the helper improves navigation.

## Tasks

- [x] Introduce the shared spawn helper module and migrate all four agent
      modules to use it.
- [x] Remove the duplicated settle/buffer/`close` logic from the agent files.
- [x] Add or adjust tests so behavior remains covered: existing
      `test/agents/*.test.ts` must still pass; add focused tests for the helper
      if there is meaningful branching that is awkward to cover only through
      full agent tests.

## Acceptance criteria

- [x] Observable CLI invocation shape is unchanged for each agent: same default
      binary names, same argv patterns, same `cwd` and `stdio`, same stdin prompt
      delivery where applicable.
- [x] Quota and model-configuration classification for each agent matches pre-refactor
      behavior (including `opencode`’s two-argument `isModelConfigurationSignal`
      usage).
- [x] `bun run typecheck` passes.
- [x] `bun test` passes.

## Documentation updates

- [x] Add a brief file-level comment on the new helper describing its role (shared
      spawn loop for CLI agents).
- [x] No README or `AGENTS.md` change unless an existing section still claims each
      agent file fully implements the spawn loop in isolation; if so, adjust that
      sentence to mention the helper.
