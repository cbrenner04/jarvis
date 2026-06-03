# Config and CLI surface for `jarvis1 --prompt`

## Decisions

- Config lives at `modes.prompt: ModeConfig` (same shape as `modes.patch`/`modes.plan`) — rules out a top-level `prompt` block that diverges from existing mode-scoped tooling.
- `--prompt <text>` is a top-level flag, not a `prompt` subcommand — rules out collision with the subcommand-dispatch table.
- Repo resolution reuses the patch order from `--repo` then cwd; prompt text is never inspected — rules out inferring repo from prompt content or last-used-project state.
- Effective `git: true` is required and `--cwd` is rejected — rules out a specless path that bypasses the worktree/commit/push/PR contract.
- Empty/whitespace-only prompt text is rejected at preflight — rules out invoking an agent with no instruction.

## Acceptance criteria

- [ ] `v1/src/config.ts` defines `modes.prompt: ModeConfig` and `DEFAULT_CONFIG` populates `modes.prompt.agentOrder`.
- [ ] `v1/src/cli.ts` parses top-level `--prompt <text>` (with optional `--repo`), routes to a `prompt` handler, and lists it in usage text.
- [ ] The `prompt` handler exits 1 with a named error when: prompt text is empty/whitespace; `--cwd` is passed; effective `git` is `false`; repo resolution fails.
- [ ] New tests cover each preflight rejection above.
- [ ] `bun run typecheck` and `bun test` pass.
