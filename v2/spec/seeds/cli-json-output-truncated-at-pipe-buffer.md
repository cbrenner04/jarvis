---
name: cli-json-output-truncated-at-pipe-buffer
---

# CLI output over 64 KiB is truncated when stdout is a pipe

## Problem

`v2/src/cli.ts:98` routes stdout through `process.stdout.write(s)` without awaiting drain, and `v2/src/cli.ts:144` calls `process.exit(await main(...))` immediately after. When stdout is a pipe, writes beyond the 64 KiB pipe buffer are still pending at exit and are dropped. Any large `--json` output piped to a consumer arrives as invalid JSON; redirecting to a file hides the bug.

## Evidence

2026-09-18, seen twice: `jarvis pipeline list --all --json | python3 -c 'import json,sys; json.load(sys.stdin)'` failed with "Unterminated string ... char 65527" / "line 1 column 65537". Reproduced: `jarvis pipeline list --all --json | wc -c` → `65536`; same command redirected to a file → `588398` bytes. The default (non-`--all`) listing, 28848 bytes, parses fine.

## Decisions

- The CLI entrypoint flushes stdout and stderr (await drain / write callback) before `process.exit`. Rules out per-command fixes that leave every other large-output command exposed.
- The exit code is unchanged. Rules out changing process semantics to fix I/O.

## Acceptance criteria

- [ ] A new v2 test spawns the real CLI as a child process with stdout piped, drives a command emitting more than 64 KiB of JSON, and asserts the full output parses and its byte length matches the expected payload; it fails against the pre-fix entrypoint.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- None; behavior fix only.
