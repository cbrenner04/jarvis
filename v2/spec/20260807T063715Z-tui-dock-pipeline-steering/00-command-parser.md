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
- Update `tui-command-parser.test.ts` parser regressions and mutation checkpoint for the unavailable-catalog guard.
- Update `tui-entry.test.tsx` so `approve foo` (and symmetric reject/resume forms) expect `unexpected_arguments` instead of `recognized_unavailable`.

## Acceptance criteria

- [ ] `tui-command-parser.test.ts` proves `approve`, `reject`, and `resume` parse as typed commands and no longer return `recognized_unavailable`.
- [ ] `tui-command-parser.test.ts` proves `approve foo`, `reject foo`, and `resume foo` return `unexpected_arguments`.
- [ ] `tui-entry.test.tsx` proves `approve foo` submits `unexpected_arguments` feedback and issues no pipeline RPC; fails against the pre-fix `recognized_unavailable` path.
- [ ] Mutation checkpoint: in `tui-command-parser.test.ts`, a `// @mutate` directive inverting the `UNAVAILABLE_COMMANDS` membership guard for a still-unavailable verb turns that regression RED.
- [ ] `bun run typecheck` passes.

## Documentation updates

None — operator and parity docs land in `03-docs`.
