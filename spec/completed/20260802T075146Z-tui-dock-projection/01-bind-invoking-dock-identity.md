# 01 - Bind invoking dock identity

## Problem

The dock cannot identify the daemon invoked by `jarvis tui` independently of discovered daemons.

## Decisions

- The command boundary resolves the machine profile before opening the monitor and passes it with the already-selected keyed socket path; discovery and selection never replace either value.
- The status digest is the exact 16-character key embedded in the invoking socket's `daemon-<key>.sock` basename, rendered as that lowercase key. An unparseable invoking path renders `unknown`, never a discovered daemon's key.
- A missing or invalid machine profile fails command admission through existing CLI error handling before a monitor opens; it never silently falls back to a discovered profile.

## Work

- Thread command-resolved machine profile and invoking keyed-socket identity through `v2/src/commands/tui.ts` into `v2/src/tui/tui-entry.tsx`.
- Add command-boundary and identity-source regressions in `v2/src/commands/tui.test.ts` and `v2/src/tui/tui-entry.test.tsx`.

## Acceptance criteria

- [x] `v2/src/commands/tui.test.ts` adds a regression that fails against the baseline and proves TUI admission resolves and supplies the invoking machine profile and keyed socket; missing or invalid profile opens no monitor and reports the existing command error.
- [x] `v2/src/tui/tui-entry.test.tsx` proves monitor state retains the supplied invocation identity while discovery adds, removes, or selects other daemon sockets.
- [x] The displayed identity uses the invoking socket basename's exact 16-character key or `unknown` for an unparseable path; discovered daemon identity never substitutes for it.
- [x] `v2/src/commands/tui.test.ts` and `v2/src/tui/tui-entry.test.tsx` carry a valid `// @mutate` directive for every added or modified executable identity/admission guard, including effect-suppressing guards; inverting each real source condition turns its pin red, with no production inversion hook.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

None — visible identity documentation lands with the painted dock in 03.
