# Docs for `jarvis1 --prompt`

Document operator and workflow semantics for the specless one-shot run in their durable home.

## Decisions

- Operator/workflow doc lives at `v2/docs/specless-prompt.md` — rules out a v1-only home because `v2/docs/documentation-standard.md` places operator behavior under `v2/docs/`.
- `v1/docs/config.md` gains a short subsection describing `modes.prompt` and `set-prompt-order` — rules out leaving the new field undocumented next to `modes.patch`/`modes.plan`.
- `README.md` gains a one-line mention of `jarvis1 --prompt` in the command overview — rules out shipping a new top-level command surface absent from the README.
- `v2/docs/v1-behaviors.md` gains entries for the new command (CLI surface, exit codes, side effects, telemetry mode) — rules out silently growing v1 behavior beyond the baseline the v2 parity review reads.

## Acceptance criteria

- [ ] `v2/docs/specless-prompt.md` exists and documents: the `jarvis1 --prompt "<text>"` invocation, the dedicated `modes.prompt.agentOrder` config, preflight rejections (`git: false`, `--cwd`, unresolvable repo, empty prompt), worktree/branch naming, the single-pass contract (no loop), the diff vs. no-diff outcomes, the harness-owned commit/push/PR shape, and exit codes.
- [ ] `v1/docs/config.md` describes `modes.prompt` alongside `modes.patch`/`modes.plan` and lists the `jarvis1 config set-prompt-order` subcommand.
- [ ] `README.md` lists `jarvis1 --prompt` in its command overview with a one-line description.
- [ ] `v2/docs/v1-behaviors.md` records: the `--prompt` CLI surface and preflight, the single-pass execution model with reuse of patch quota fallback, telemetry rows with `mode: "prompt"`, the diff/no-diff branch, and the exit-code mapping.
- [ ] No durable operator/workflow content for `--prompt` is duplicated in `v1/docs/`; cross-links from `v1/docs/config.md` point at `v2/docs/specless-prompt.md`.
