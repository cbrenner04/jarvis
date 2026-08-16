# Expose init and align entry-point docs

## Problem

- The completed handler must be discoverable through the public CLI without reimplementing setup or readiness behavior.

## Prerequisites

- Implement after [00 - Bootstrap machine profile and agent roster](./00-bootstrap-machine-profile-and-agent-roster.md), [01 - Register the current repository](./01-register-current-repository.md), [02 - Configure and safely scaffold the planning directory](./02-configure-and-safely-scaffold-planning-directory.md), [03 - Evaluate and render initialization readiness](./03-evaluate-and-render-initialization-readiness.md), and [04 - Add read-only init checks and selectors](./04-add-read-only-init-checks-and-selectors.md); rules out temporary dispatch stubs, duplicated option parsing, and public invocation before handler-level behavior is verified.

## Decisions

- Register `init` through the existing top-level dispatch and command-tree help sources; all prior subspecs remain handler-level only.
- Parser-aligned help lists `--profile`, `--name`, `--target-dir`, `--scaffold`, and `--check`.
- Invalid operands print init usage to stderr and exit `1`; no dispatch path prompts for input.
- README and onboarding make v2 init the primary entry path before first workflow use.

## Tasks

- Wire the completed handler into top-level dispatch, usage, command-tree help, and parser/help parity coverage.
- Add public dispatch regressions for discovery, direct help, `--help`, all flags, invalid operands, and absence of prompting.
- Add in-body mutation directives to the named pins for headline registration and every dispatch, invalid-operand, and help-routing guard; use unique production anchors and no production invert hooks.
- Update README and onboarding entry paths named below.

## Acceptance criteria

- [ ] Public `jarvis init` dispatch and help expose all five options, direct help and `--help` agree, invalid operands print init usage to stderr and exit `1`, and no route prompts. `v2/src/cli.test.ts` — `init dispatch and help expose the non-interactive contract`; fails against the pre-fix code.
- [ ] `v2/src/cli.test.ts` — `init dispatch and help expose the non-interactive contract`; Keystone checkpoint: its body carries one `// @mutate` directive that removes top-level init registration, and the mutation turns the named pin RED.
- [ ] Parser/help parity covers every init long option so a parser-only or help-only option fails the suite. `v2/src/cli/help-flags-parity.test.ts` — `init parser and help flags stay aligned`; fails against the pre-fix code.
- [ ] `v2/src/cli.test.ts` — `init routing guard inversions expose hidden or invalid routes`; Mutation checkpoint: its body carries distinct `// @mutate` directives for every dispatch, invalid-operand, and help-routing guard, and each mutation turns the named pin RED.
- [ ] `README.md` uses `jarvis init` in installation, configuration, quickstart, and command inventory; `v2/docs/onboarding.md` includes setup and readiness verification before the first run.
- [ ] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- `README.md` — align installation, quickstart, configuration, and command inventory with init.
- `v2/docs/onboarding.md` — add init and readiness verification before the first workflow.
