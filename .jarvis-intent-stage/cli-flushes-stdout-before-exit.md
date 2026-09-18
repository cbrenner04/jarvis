---
name: cli-flushes-stdout-before-exit
---

# CLI flushes stdout/stderr before exit

Unsplit rationale: the fix touches only the CLI entrypoint (`v2/src/cli.ts`); one surface.

## Primary implementation surface

- `v2/src/cli.ts` entrypoint output/exit path

## Prerequisites

## Behavior

- The entrypoint awaits stdout and stderr flush (drain / write callback) before `process.exit`, so output over 64 KiB piped to a consumer arrives whole. Rules out per-command fixes.
- Exit code unchanged.

## Acceptance criteria

- [ ] A new v2 test spawns the real CLI with stdout piped, drives a command emitting more than 64 KiB of JSON, and asserts the full output parses and its byte length matches the expected payload; it fails against the pre-fix entrypoint.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- None; behavior fix only.
