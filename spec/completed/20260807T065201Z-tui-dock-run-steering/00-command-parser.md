# Command parser

## Problem

Typed `kill` and `pause` report `recognized_unavailable` naming CLI equivalents; `resume-run` returns `unknown_verb`. The parser has no run-steering command kinds, so dispatch cannot wire them in `01-entry-dispatch`.

## Prerequisites

- Command parser exists (`tui-command-parser.ts`) with `TuiCommand`, `UNAVAILABLE_COMMANDS`, `ZERO_ARG_VERBS`.
- Pipeline steering verbs (`approve`/`reject`/`resume`) already parse to zero-arg command kinds (merged `tui-dock-pipeline-steering`).

## Decisions

- Register `resume-run` as a parser verb distinct from pipeline `resume` — rules out leaving it `unknown_verb` or overloading pipeline `resume`.
- Extend `TuiCommand` with `kill`, `pause`, and `resume-run` kinds; each parses to a zero-arg command kind and rejects trailing tokens with `unexpected_arguments` — rules out operand-bearing forms or silent acceptance of extra tokens.
- Remove only `kill` and `pause` from `UNAVAILABLE_COMMANDS`; `log` stays unavailable until `tui-dock-log-follow` — rules out stale unavailable pointers for verbs this slice ships.

## Work

- Add `kill`, `pause`, and `resume-run` to the `TuiCommand` union and `ZERO_ARG_VERBS` (or the equivalent verb set), returning `{ kind }` for each.
- Drop `kill` and `pause` from `UNAVAILABLE_COMMANDS`; leave `log`.
- Add parser regressions per Acceptance criteria.

## Acceptance criteria

- [x] `tui-command-parser.test.ts` test `parses resume-run as a run-steering verb` fails against the pre-fix code (`unknown_verb`) and passes after implementation.
- [x] `tui-command-parser.test.ts` test `parses kill and pause as run-steering verbs` fails against the pre-fix code (`recognized_unavailable`) and passes after implementation.
- [x] `tui-command-parser.test.ts` proves `kill`, `pause`, and `resume-run` return typed command kinds with `unexpected_arguments` when trailing tokens are present.
- [x] The parser maps `resume-run` to a run-steering command kind; `kill` and `pause` no longer map to `recognized_unavailable`; `log` still maps to `recognized_unavailable`.
- [x] `bun run typecheck`, `bun run check`, and `bun run test:v2` pass.

## Documentation updates

None — operator and parity docs land in `02-docs`.
