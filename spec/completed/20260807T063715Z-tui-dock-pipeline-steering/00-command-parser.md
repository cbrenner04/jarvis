# Command parser

## Problem

`approve`, `reject`, and `resume` tokenize successfully but return `recognized_unavailable` naming CLI equivalents. Dispatch cannot run until the parser admits them as typed zero-argument verbs.

## Prerequisites

- Fan-out order: implement only after merged `tui-remove-waitstate-window-detail`; before `tui-dock-run-steering` and `tui-dock-log-follow`.
- `tui-command-parser.ts` already parses `start`, `expand`, and `collapse` plus named errors.

## Decisions

- `approve`, `reject`, and `resume` parse as zero-argument dock verbs — rules out positional CLI mirroring (`approve <stage-id> …`) or keeping `recognized_unavailable`.
- Trailing tokens after a bare verb (`approve foo`, `reject bar`, `resume baz`) return `unexpected_arguments` — rules out silently accepting operands or regressing to `recognized_unavailable`.
- Remove `approve`, `reject`, and `resume` from `UNAVAILABLE_COMMANDS` — rules out stale unavailable pointers after dispatch ships.

## Work

- Extend `TuiCommand` / `parseTuiCommand` for `approve`, `reject`, and `resume`.
- Update `tui-command-parser.test.ts` parser regressions. For the mutation checkpoint, author a **plain** `test("still-unavailable verbs classify as recognized_unavailable", () => { … })` (not `test.each`) that asserts a still-unavailable verb such as `kill` parses to `{ kind: "error", code: "recognized_unavailable", … }`, and place the `// @mutate` directive **inside that test body** so the criterion's named title resolves. The criterion below names that exact title.
- Update `tui-entry.test.tsx` so `approve foo` (and symmetric reject/resume forms) expect `unexpected_arguments` instead of `recognized_unavailable`.

## Acceptance criteria

- [x] `tui-command-parser.test.ts` proves `approve`, `reject`, and `resume` parse as typed commands and no longer return `recognized_unavailable`.
- [x] `tui-command-parser.test.ts` proves `approve foo`, `reject foo`, and `resume foo` return `unexpected_arguments`.
- [x] `tui-entry.test.tsx` proves `approve foo` submits `unexpected_arguments` feedback and issues no pipeline RPC; fails against the pre-fix `recognized_unavailable` path.
- [x] Mutation checkpoint: in `tui-command-parser.test.ts`, the plain `test(...)` titled exactly `still-unavailable verbs classify as recognized_unavailable` carries `// @mutate v2/src/tui/tui-command-parser.ts "Object.hasOwn(UNAVAILABLE_COMMANDS, verb)" -> "false"` inside its body; the mutation (a still-unavailable verb like `kill` no longer classifies as `recognized_unavailable`) turns that test RED. Use a plain `test`, not `test.each`, and name the test in this criterion so the directive links.
- [x] `bun run typecheck` passes.

## Documentation updates

None — operator and parity docs land in `03-docs`.
