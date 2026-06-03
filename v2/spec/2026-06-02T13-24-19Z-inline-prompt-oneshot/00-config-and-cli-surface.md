# Config and CLI surface for `jarvis1 --prompt`

Add the `modes.prompt` config block and the top-level `--prompt "<text>"` CLI surface, including preflight validation. No agent is invoked in this subspec — the handler exits after preflight.

## Decisions

- New config block `modes.prompt: ModeConfig` (same shape as `modes.patch`/`modes.plan`) — rules out a top-level `prompt` block, preserves existing mode-scoped shape.
- Default `modes.prompt.agentOrder` mirrors the patch default agent order — rules out empty/null default that would force every operator to configure before first use.
- `--prompt <text>` is a top-level flag, not a subcommand — rules out `jarvis1 prompt <text>` which collides with the subcommand-dispatch table.
- `--prompt` accepts `--repo <name|path|url>` and `--max-iterations` is rejected — rules out reusing patch's loop knobs since the run is single-pass by contract.
- Effective `git` must be `true`; `git: false` (top-level or project override) exits 1 with a named error — rules out a loop-only specless path since commit/push/PR are part of the contract.
- `--cwd` combined with `--prompt` exits 1 — rules out bypassing worktree creation.
- Repo resolution reuses the patch resolution order from `--repo` and cwd (registered project → ad-hoc git checkout); prompt text is never inspected — rules out inferring target from prompt content or last-used-project state.
- Empty/whitespace-only prompt text exits 1 — rules out spawning an agent with no instruction.
- `modes.prompt.agentOrder` is validated by the existing config loader at load time — rules out lazy validation that fails only when `--prompt` is used.
- `jarvis1 config set-prompt-order <agent:model,...>` is added alongside `set-patch-order`/`set-plan-order` — rules out forcing operators to hand-edit JSON to change the dedicated order.

## Acceptance criteria

- [ ] `v1/src/config.ts` defines `modes.prompt: ModeConfig` in the v2 schema with the same validation rules as `modes.patch`; `loadConfig` accepts configs with and without the field (auto-bootstraps default on missing).
- [ ] `DEFAULT_CONFIG` in `v1/src/config.ts` includes a `modes.prompt.agentOrder` matching the patch default order.
- [ ] `v1/src/cli.ts` parses a top-level `--prompt <text>` flag and routes to a new `prompt` handler; the parsed args expose the prompt text and an optional `--repo` value.
- [ ] CLI usage text in `v1/src/cli.ts` lists `--prompt` under the commands overview.
- [ ] The `prompt` handler exits 1 with a named error when: prompt text is empty or whitespace-only; `--cwd` is also passed; effective `git` is `false` for the resolved project; resolution fails (no `--repo`, cwd not in a registered project or git checkout).
- [ ] `jarvis1 config set-prompt-order <agent:model,...>` is added with the same parser and validation as `set-patch-order`.
- [ ] `bun test` includes a new test file covering: default config has a populated `modes.prompt.agentOrder`; `--prompt` with empty text exits 1; `--prompt --cwd` exits 1; `--prompt` against a `git: false` project exits 1; `--prompt` with an unresolvable repo exits 1; `set-prompt-order` updates the field.
- [ ] `bun run typecheck` and `bun test` pass.
