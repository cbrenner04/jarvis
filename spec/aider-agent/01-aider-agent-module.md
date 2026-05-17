# 01 — Aider agent module

## Problem

Jarvis needs a new `AiderAgent` class in `src/agents/aider.ts` that
implements the `Agent` interface from `src/agents/types.ts` and spawns
`aider` non-interactively. The module must follow the same shape as
`src/agents/opencode.ts` so the rest of the harness (fallback, quota
detection, logging, attribution) does not change.

This subspec adds the module file only. Extending `AgentName` (declared
in both `src/agents/types.ts` and `src/config.ts`) and wiring the
factories in `src/modes/patch/run.ts`, `src/modes/plan/draft.ts`, and
`src/modes/plan/review.ts` lives in subspec 02. The new module is
therefore unreferenced after this subspec lands; that's fine — landing
it in isolation keeps the diff focused. Cast `"aider" as AgentName` in
the class body the same way `opencode.ts` does today so the file
typechecks before subspec 02 widens the union.

## Decisions

- Binary name: `aider`.
- Invocation: the exact argv recorded in subspec 00's `## Verified flags`
  section. The expected shape is:

  ```sh
  aider --message <prompt> --model <provider/model> \
        --yes-always --no-auto-commits --no-stream
  ```

  (`--no-git` is included if subspec 00 confirms it is the right posture.)
- Model is **required**. Aider's effective model otherwise depends on
  `~/.aider.conf.yml` / `AIDER_MODEL` env vars, which are hard to reason
  about from inside the harness. The agent constructor accepts `model` and
  uses it on every invocation.
- The `cwd` passed by the harness is the worktree root, same as other
  agents. Pass it through to `runAgent` so aider operates inside the
  worktree.
- The prompt is passed as the argument to `--message`, not on stdin.
  Jarvis prompts are intentionally minimal (rules + spec pointer; behavior
  lives in spec files, not the prompt — see `AGENTS.md`), so positional /
  flag-argument argv is fine. Revisit only if jarvis ever starts inlining
  large context.
- Do **not** pass any "skip permissions" flag beyond `--yes-always`, which
  is the documented non-interactive switch. Auto-commits stay off so jarvis
  remains the only thing committing in the worktree.
- Reuse `runAgent` from `src/agents/spawn.ts` and the existing
  `isModelConfigurationSignal` / `isQuotaSignal` helpers from
  `src/agents/quota.ts`. Aider-specific signal additions are deferred to
  subspec 03.
- Cost / usage reporting: report `usage_source: "unavailable"` and
  `cost_source: "no-usage"`, matching `opencode.ts`. Aider does not emit
  structured token usage on stdout, and local-LLM runs have no per-token
  cost.

## Behavior

The new module mirrors `src/agents/opencode.ts`:

```ts
// Permission posture: safe-edits (see spec/completed/2026-05-11-permissions/00-default-posture.md).
// Aider runs non-interactively with --yes-always; auto-commits are disabled so
// jarvis remains the sole committer in the worktree.
import { runAgent } from "./spawn.ts";
import type {
  Agent,
  AgentName,
  AgentResult,
  AgentRunOptions,
} from "./types.ts";

export type AiderAgentOptions = {
  binary?: string;
  model: string;
};

export class AiderAgent implements Agent {
  readonly name = "aider" as AgentName;
  // ...
}
```

The constructor signature mirrors `OpencodeAgent` (model is required).
Stream handling and exit-code interpretation are otherwise identical to
`opencode.ts`.

## Tasks

- [ ] Create `src/agents/aider.ts` with an `AiderAgent` class implementing
      `Agent` from `src/agents/types.ts`.
- [ ] Spawn `aider` via `runAgent` with the argv finalized in subspec 00.
- [ ] Wire stdout/stderr capture, error handling, and exit-code → kind
      mapping the same way `opencode.ts` does.
- [ ] Export `AiderAgent` as a named export from `src/agents/aider.ts`,
      mirroring how `OpencodeAgent` is exported from
      `src/agents/opencode.ts`. There is no central barrel — the
      factories in subspec 02 import directly from the module path.
- [ ] Add a test under `test/` that:
      - Constructs `AiderAgent({ binary: <stub>, model: "ollama/llama3" })`.
      - Spawns against a stub binary or asserts argv via a spawn mock.
      - Verifies `--message <prompt>`, `--model ollama/llama3`,
        `--yes-always`, and `--no-auto-commits` are all in the argv.
      - Verifies no "skip permissions" flag beyond `--yes-always` is
        present.

## Acceptance criteria

- [ ] `AiderAgent` implements `Agent` and compiles under `bun run typecheck`.
- [ ] The argv assertion test passes.
- [ ] Importing `AiderAgent` from `src/agents/aider.ts` does not break
      existing agent imports.
- [ ] `bun test` passes.
- [ ] `bun run check` passes.

## Documentation updates

- None. Subspec 04 handles README/docs updates.
