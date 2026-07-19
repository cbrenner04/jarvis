---
name: cleanup-hangs-on-noninteractive-stdin
---

# `jarvis cleanup` (no `--dry-run`) hangs forever on non-interactive stdin, pinning a core

## Problem

`jarvis cleanup` without `--dry-run` prompts for confirmation via
`createPromptFunction()` (`v2/src/commands/cleanup-cli.ts`), which does
`process.stdin.once("data", ...)`. When stdin is non-interactive and closed
(e.g. `< /dev/null`, or piped through a command like `head` that doesn't
forward input), stdin emits `end`/EOF rather than a `data` event, so the
`once("data", ...)` listener never fires and the promise never resolves —
the process hangs indefinitely rather than detecting EOF and failing fast.

Observed live, 2026-07-19: a `jarvis cleanup 2>&1 | head -5` invocation
(stdin redirected from `/dev/null` by the calling shell wrapper) ran for
**over 19 hours at 99% CPU on one core** before being found and killed by
hand. Sustained 99% CPU (not the ~0% expected for a blocked event-loop wait)
suggests something beyond the confirmation prompt is also spinning — worth
confirming during investigation. This kind of stray, silently-running
process is exactly the CPU-contention class documented in
`v1/docs/operator-runbook.md` § `ps`/`pgrep` blindness (gate flakiness,
`exit 124` timeouts, disk-I/O-error-flavored SQLite contention) — a real,
unaccounted-for confound behind an unknown fraction of this session's
gate/test flakiness.

## Decisions

- Detect non-interactive/closed stdin (e.g. `!process.stdin.isTTY`, or an
  `end`/`close` event racing the `data` listener) and fail fast with a clear
  error instead of hanging; rules out silently blocking forever.
- Investigate and fix the sustained 99% CPU while blocked — a genuinely
  blocked stdin read should not consume CPU; rules out treating this as
  "just a hang" without explaining the CPU usage.
- Apply the same fix to any other jarvis CLI command using the same
  `process.stdin.once("data", ...)` confirmation pattern; rules out a
  point-fix limited to `cleanup`.

## Acceptance criteria

- [ ] `jarvis cleanup` (no `--dry-run`, no `--abandon`) with stdin redirected
      from `/dev/null` exits promptly with a clear error (not a hang) instead
      of running unbounded.
- [ ] The fix does not change interactive-terminal behavior (a real TTY still
      prompts and waits for `y`/`N`).
- [ ] Root cause of the observed 99% CPU while ostensibly blocked is
      identified and fixed, not just the hang itself.
- [ ] A regression test drives `runCleanupCliCommand`/`createPromptFunction`
      with non-interactive stdin and asserts prompt resolution/failure
      within a bounded time.

## Documentation updates

None — this is an internal reliability fix; no documented behavior changes.
