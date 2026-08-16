# Expose init and align entry-point docs

## Problem

- The implemented init handler is not reachable or discoverable through v2's top-level dispatch and help surfaces, and entry-point docs still teach manual or v1 setup.

## Prerequisites

- Implement after the setup and readiness behavior from [00 - Initialize machine and project state](./00-initialize-machine-and-project-state.md) and [01 - Report initialization readiness](./01-report-initialization-readiness.md); rules out temporary dispatch stubs or duplicated option parsing.

## Decisions

- Register `init` through the existing top-level dispatch and command-tree help sources; rules out a side registry or special-case dispatch.
- Help lists `--profile`, `--name`, `--target-dir`, `--scaffold`, and `--check` from parser-aligned declarations; rules out undocumented or stale options.
- Invalid operands exit `1` with init usage and every route remains non-interactive; rules out fallback parsing and prompts.
- README and onboarding teach init before first workflow use; rules out retaining hand edits or `jarvis1 init` as the primary entry path.

## Tasks

- Wire the init handler into top-level dispatch, usage, command-tree help, and parser/help parity coverage.
- Add dispatch regressions for discovery, help, option parity, invalid operands, and absence of prompting.
- Add in-body mutation directives to the named pinning tests for the headline registration and every added routing/help guard; use unique production anchors and no production invert hooks.
- Update README and onboarding entry paths named below.

## Acceptance criteria

- [ ] Top-level dispatch and help expose `init` and all five options, direct help and `--help` agree, invalid operands print init usage to stderr and exit `1`, and no route prompts. `v2/src/cli.test.ts` — `init dispatch and help expose the non-interactive contract`; fails against the pre-fix code.
- [ ] `v2/src/cli.test.ts` — `init dispatch and help expose the non-interactive contract`; Keystone checkpoint: its body carries one `// @mutate` directive that removes top-level init registration, and the mutation turns the named pin RED.
- [ ] Parser/help parity covers every init long option so a parser-only or help-only option fails the suite. `v2/src/cli/help-flags-parity.test.ts` — `init parser and help flags stay aligned`; fails against the pre-fix code.
- [ ] `v2/src/cli.test.ts` — `init routing guard inversions expose hidden or invalid routes`; Mutation checkpoint: its body carries distinct `// @mutate` directives for every added dispatch, invalid-operand, and help-routing guard, and each mutation turns the named pin RED.
- [ ] `README.md` uses `jarvis init` in installation, configuration, quickstart, and command inventory; `v2/docs/onboarding.md` includes setup and readiness verification before the first run.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `README.md` — align installation, quickstart, configuration, and command inventory with init.
- `v2/docs/onboarding.md` — add init to installation and first-run routing.
