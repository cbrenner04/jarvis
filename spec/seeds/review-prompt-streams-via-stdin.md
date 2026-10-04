---
name: review-prompt-streams-via-stdin
risk: medium
effort: low
---

# Review invocations stream the prompt via stdin instead of argv

## Problem

The review-debate step passes the assembled prompt, including the full lane diff, to the vendor CLI as a command-line argument. On a large diff (the 424-file `shared/` move and the 44-file catalog retag on 2026-10-04) `posix_spawn` fails with `E2BIG: argument list too long`, the row pauses with `invocation_error`, and the only recovery is re-running the implement with `--review-passes 0`, which drops the review entirely.

## Decisions

- The invocation layer never places the prompt body in argv; it streams it on stdin for every vendor whose CLI accepts prompt input that way (claude `-p` reads stdin; codex `exec` reads stdin; cursor-agent: plan must verify the stdin form or fall back to a temp file passed by path).
- Argv carries only flags and bounded identifiers; the existing byte-identical default-argv tests update to the new shape once, and a test pins that a multi-megabyte prompt spawns without `E2BIG`.
- No truncation of the diff as a substitute: review quality must not silently degrade on large changes.

## Evidence

- Runs `ff45d596` and `3672f8aa` on 2026-10-04: `invocation_failure_diagnostic` stderr `Error: E2BIG: argument list too long, posix_spawn '/Users/…/cursor'`.
