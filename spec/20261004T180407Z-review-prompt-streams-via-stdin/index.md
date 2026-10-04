# Review invocations stream the prompt via stdin instead of argv

Stop passing review-debate lane diffs as a cursor trailing argv positional (reachable on main: `runCursorBinding` appends `promptText` in `buildArgv`, which produced `E2BIG` on large trees per `docs/operator-runbook.md`). Pipe the prompt through the existing `singleSpawn` stdin channel for cursor; leave claude/codex byte-identical; defer opencode argv delivery.

- [x] [00-cursor-binding-prompt-via-stdin.md](./00-cursor-binding-prompt-via-stdin.md) — cursor `runCursorBinding` uses stdin (or temp-file fallback only if re-probe fails), regression tests, docs
