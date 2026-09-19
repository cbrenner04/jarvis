---
name: cli-flushes-stdout-before-exit
---

# CLI flushes stdout/stderr before exit

## Primary implementation surface

- `v2/src/cli.ts` entrypoint output/exit path

## Prerequisites

## Behavior

- The entrypoint awaits stdout and stderr flush (drain / write callback) before `process.exit`, so output over 64 KiB piped to a consumer arrives whole.
- Exit code unchanged.

## Acceptance criteria

- [ ] A new v2 test spawns the real CLI with stdout and stderr piped against a fixture state store seeded so `pipeline list --all --json` emits more than 64 KiB, and asserts the full stdout parses as JSON with a byte length matching the expected payload; it fails against the pre-fix entrypoint (reachable on main: `pipeline list --all --json | wc -c` → `65536`).
- [ ] The same test, with a command that writes more than 64 KiB to stderr and exits non-zero, asserts the full stderr arrives and the non-zero exit code is preserved.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- None: bug fix restoring intended output, no v1 parity impact, so no `v2/docs/v1-behaviors.md` entry.
