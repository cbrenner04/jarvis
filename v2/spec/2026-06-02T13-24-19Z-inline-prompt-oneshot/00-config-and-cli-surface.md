# Config and CLI surface for `jarvis1 --prompt`

Add `modes.prompt`, the top-level `--prompt` flag, and preflight rejections. Handler stub exits after preflight; no agent invocation here.

## Decisions

- Config lives at `modes.prompt: ModeConfig` (same shape as `modes.patch`/`modes.plan`) — rules out a top-level `prompt` block that diverges from existing mode-scoped tooling.
- Default `modes.prompt.agentOrder` mirrors the patch default — rules out an empty default that forces operators to configure before first use.
- `--prompt <text>` is a top-level flag, not a `prompt` subcommand — rules out collision with the subcommand-dispatch table.
- Repo resolution reuses the patch order from `--repo` and cwd; prompt text is never inspected — rules out inferring repo from prompt content or last-used-project state.
- Effective `git: true` is required and `--cwd` is rejected — rules out a specless path that bypasses the worktree/commit/push/PR contract.
- Empty/whitespace-only prompt text is rejected at preflight — rules out invoking an agent with no instruction.
- `jarvis1 config set-prompt-order <agent:model,...>` is added — rules out forcing operators to hand-edit JSON for the dedicated order.

## Acceptance criteria

- [ ] `v1/src/config.ts` defines `modes.prompt: ModeConfig` and `DEFAULT_CONFIG` populates `modes.prompt.agentOrder` with the patch default order.
- [ ] `v1/src/cli.ts` parses top-level `--prompt <text>` (with optional `--repo`), routes to a `prompt` handler, and lists it in usage text.
- [ ] The `prompt` handler exits 1 with a named error when: prompt text is empty/whitespace; `--cwd` is passed; effective `git` is `false`; repo resolution fails.
- [ ] `jarvis1 config set-prompt-order` updates `modes.prompt.agentOrder` using the same parser/validation as `set-patch-order`.
- [ ] New tests cover each preflight rejection above and the `set-prompt-order` happy path.
- [ ] `bun run typecheck` and `bun test` pass.
