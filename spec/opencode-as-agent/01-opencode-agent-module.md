# 01 — Opencode agent module

## Problem

Jarvis needs a new `OpencodeAgent` class in `src/agents/opencode.ts` that
implements the `Agent` interface and spawns `opencode run` non-interactively.
The module must follow the same shape as the existing claude, codex, and
cursor agents so the rest of the harness (fallback, quota detection, logging)
does not change.

## Decisions

- Binary name: `opencode`.
- Invocation: `opencode run --model <provider/model> --format default <prompt>`.
  - `--format default` matches the plain-text transcript shape the harness
    consumes today. `json` is reserved for future structured-event support.
  - The prompt is passed as the trailing positional `message` argument, not
    on stdin. `opencode run` accepts message as positional args (per
    `opencode run -h`). macOS `ARG_MAX` is 1 MiB and jarvis prompts are
    intentionally minimal (rules + spec pointer; behavior lives in spec
    files, not the prompt — see `AGENTS.md`), so positional argv is fine.
    Revisit only if jarvis ever starts inlining large context.
- Model is **required**. Unlike `claude` (where omitting `--model` is valid),
  opencode's effective model depends on the user's global config and is hard
  to reason about without explicit selection. The agent constructor accepts
  `model` and uses it on every invocation.
- The `cwd` passed by the harness is the worktree root, same as other agents.
  Pass it through to `spawn`.
- Do **not** pass `--dangerously-skip-permissions`. Permissions are handled
  by the user's `~/.config/opencode/opencode.json` (subspec 04). This
  preserves the README policy that jarvis never enables bypass flags.
- Reuse the existing `isModelConfigurationSignal` and `isQuotaSignal`
  helpers from `src/agents/quota.ts`. Opencode-specific signal additions
  are deferred to subspec 03.

## Behavior

The new module mirrors `src/agents/claude.ts`:

```ts
// Permission posture: safe-edits (see spec/permissions/00-default-posture.md).
// Permission handling: configured in ~/.config/opencode/opencode.json (see
// spec/opencode-as-agent/04-opencode-permission-stanza.md). Jarvis does not
// pass --dangerously-skip-permissions.
import { spawn } from "node:child_process";
import { isModelConfigurationSignal, isQuotaSignal } from "./quota.ts";
import type { Agent, AgentResult } from "./types.ts";

export type OpencodeAgentOptions = {
  binary?: string;
  model: string;
};

export class OpencodeAgent implements Agent {
  readonly name = "opencode" as const;
  // ...
}
```

The constructor signature is intentionally different from the other agents
(model is required, not optional). This is enforced at compile time, not
runtime.

Stream handling, exit-code interpretation, and quota/model-config detection
are otherwise identical to `claude.ts`.

## Tasks

- [ ] Create `src/agents/opencode.ts` with an `OpencodeAgent` class
      implementing `Agent` from `src/agents/types.ts`.
- [ ] Spawn `opencode run` with `--model`, `--format default`, and the prompt
      as a trailing positional.
- [ ] Wire stdout/stderr capture, error handling, and exit-code → kind
      mapping the same way `claude.ts` does.
- [ ] Export the class from wherever the other agent classes are exported
      (mirror the existing pattern).
- [ ] Add a test under `test/` that:
      - Constructs `OpencodeAgent({ binary: <stub>, model: "AirProxy/test" })`.
      - Spawns against a stub binary or asserts argv via a spawn mock.
      - Verifies `run`, `--model AirProxy/test`, `--format default`, and the
        prompt-as-positional are all in the argv.
      - Verifies `--dangerously-skip-permissions` is **not** present.

## Acceptance criteria

- `OpencodeAgent` implements `Agent` and compiles under `bun run typecheck`.
- The argv assertion test passes.
- Importing `OpencodeAgent` in `src/index.ts` (or wherever agents are
  registered) does not break existing agent imports.
- `bun test` passes.
- `bun run check` passes.

## Documentation updates

- None. Subspec 05 handles README/docs updates.
