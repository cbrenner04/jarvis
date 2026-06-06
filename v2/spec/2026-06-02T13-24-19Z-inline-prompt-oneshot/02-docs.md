# Docs for `jarvis1 --prompt`

## Decisions

- Operator/workflow doc lives at `v1/docs/specless-prompt.md` — `--prompt` is a v1 behavior (nothing ships in v2 yet), so it's documented in v1; `v2/docs/v1-behaviors.md` still records it as a behavior to carry forward.

## Acceptance criteria

- [ ] `v1/docs/specless-prompt.md` documents: the `jarvis1 --prompt "<text>"` invocation, `modes.prompt.agentOrder` config, preflight rejections (`git: false`, `--cwd`, unresolvable repo, empty prompt), worktree/branch naming, single-pass contract, diff vs. no-diff outcomes, harness-owned commit/push/PR shape, and exit codes.
- [ ] `v1/docs/config.md` describes `modes.prompt` alongside `modes.patch`/`modes.plan`, lists `jarvis1 config set-prompt-order`, and cross-links to `v1/docs/specless-prompt.md` rather than duplicating its content.
- [ ] `README.md` lists `jarvis1 --prompt` in its command overview with a one-line description.
- [ ] `v2/docs/v1-behaviors.md` records the `--prompt` CLI surface, preflight, single-pass execution with shared quota fallback, `mode: "prompt"` telemetry, diff/no-diff branch, and exit-code mapping.
