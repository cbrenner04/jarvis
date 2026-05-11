# 01 — AirProxy and Copilot agent modules

## Problem

`OpencodeAgent` is a generic wrapper. To get distinct entries in
`agentOrder` and `patchModels` for `airproxy` and `copilot`, jarvis needs
two named agent classes that differ only in the `name` they report and the
default model wired up at construction. Keep them thin wrappers — no
duplicated spawn or stream-handling logic.

## Decisions

- New files: `src/agents/airproxy.ts`, `src/agents/copilot.ts`.
- Each exports a class (`AirProxyAgent`, `CopilotAgent`) that
  **delegates** to an internal `OpencodeAgent` rather than re-implementing
  the spawn loop. Reasoning: the only differences are `name` and
  default-model resolution; everything else (argv shape, quota detection,
  stream handling) is identical and should not drift.
- Constructor signatures:

  ```ts
  export type AirProxyAgentOptions = { binary?: string; model: string };
  export class AirProxyAgent implements Agent {
    readonly name = "airproxy" as const;
    constructor(opts: AirProxyAgentOptions) { /* wraps OpencodeAgent */ }
    run(prompt: string, opts: { cwd: string }): Promise<AgentResult> {
      return this.#inner.run(prompt, opts);
    }
  }
  ```
- The wrapper does **not** validate that `model` starts with the
  expected provider prefix. Opencode itself will return a model_config
  signal if the user passes a mismatched string, and forcing the prefix
  in jarvis would prevent users from doing things like routing AirProxy
  through a different provider name in their opencode config.
- Quota and model_config detection use the existing helpers in
  `src/agents/quota.ts`, but with the agent name passed through
  (`"airproxy"` / `"copilot"`) so subspec 03 can add provider-specific
  signals if needed.

## Tasks

- [ ] Create `src/agents/airproxy.ts` per the structure above.
- [ ] Create `src/agents/copilot.ts` per the structure above.
- [ ] Export both classes wherever the existing agent classes are
      exported.
- [ ] Add tests under `test/`:
      - Constructing `AirProxyAgent({ binary: <stub>, model: "AirProxy/x" })`
        spawns `opencode run --model AirProxy/x --format default <prompt>`.
      - Constructing `CopilotAgent({ binary: <stub>, model: "github-copilot/y" })`
        spawns `opencode run --model github-copilot/y --format default <prompt>`.
      - Both agents report the correct `name` value.
      - Neither passes `--dangerously-skip-permissions`.

## Acceptance criteria

- Both modules implement `Agent` and compile under `bun run typecheck`.
- The new tests pass.
- `OpencodeAgent` still works as before (the wrappers do not modify it).
- `bun test` and `bun run check` pass.

## Documentation updates

- None. Subspec 04 handles README/docs updates.
