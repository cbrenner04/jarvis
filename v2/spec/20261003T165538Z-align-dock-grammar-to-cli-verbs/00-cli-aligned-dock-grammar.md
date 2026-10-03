# CLI-aligned dock grammar

## Problem

The TUI dock parses bespoke one-word verbs (`start`, `approve`, `kill`, `resume-run`, …) while operators type the shell grammar minus `jarvis` (`pipeline start …`, `run kill`, …) and get `unknown_verb`. Parser output and `tui-entry.tsx` dispatch are one operator surface; renaming verbs without both is unobservable.

## Prerequisites

- `run pause` is retired from the CLI and the dock already rejects bare `pause` (`v2/spec/completed/20261003T010216Z-retire-run-pause`, `v2/src/commands/run.test.ts` `run pause is an unknown subcommand`, `tui-command-parser.test.ts` `pause is no longer a dock verb`).

## Decisions

- Primary dock grammar is the `jarvis` CLI subcommand path with the `jarvis` prefix stripped (`pipeline start|approve|reject|resume`, `run kill|resume|log`) — rules out bespoke bare verbs as the documented or accepted primary grammar.
- Legacy bare verbs (`start`, `approve`, `reject`, `resume`, `kill`, `resume-run`, `log`) hard-cut to `unknown_verb` with no compatibility aliases — rules out dual grammars or undocumented alias acceptance.
- Steering verbs accept only the CLI subcommand token path with **no target positionals**; dispatch resolves targets from the current tree/attention selection exactly as today's zero-arg bespoke verbs — rules out dock parsing of shell id positionals (`pipeline approve <pipeline-id> <stage-id> <branch-key>`, `run kill <run-id>`, …) and any off-selection dispatch.
- Trailing tokens after a recognized steering path (`pipeline approve foo`, `run kill run-1`, …) yield `unexpected_arguments`, same as today's bare-verb trailing-token rejection — rules out silently ignoring typed ids.
- `pipeline start` follows the existing `jarvis pipeline start` positional/flag grammar (`<project>`, exactly one of `--seed` / `--seed-text`, same error codes); the leading token pair is `pipeline start` instead of bare `start` — rules out a dock-only start shorthand.
- `pipeline start` accepts optional `--detach` anywhere among the start flags and ignores it (dock admission stays detached) — rules out `unknown_option` rejection for an operator habit copied from the shell.
- `expand` and `collapse` stay bare one-word verbs with no `view` namespace — rules out inventing a CLI-less namespace operators must learn separately.
- Internal `TuiCommand` kinds stay discriminated (`resume-run` for `run resume` vs `resume` for `pipeline resume`); only the parsed buffer grammar changes — rules out a dispatch-wide kind rename in this change.
- `isRunSteeringCommandBuffer` treats buffers whose trimmed token prefix is `run kill` or `run resume` as run-steering for pending-admission bypass, matching today's `kill` / `resume-run` prefix rule — rules out blocking kill/resume while `pipeline start` admission is pending.
- Steering RPC eligibility, feedback codes, at-most-one in-flight admission, parse-error reporting on `lastCommandResult`, selection-error retention of command focus/buffer/cursor, and successful-dispatch buffer clear are unchanged — rules out treating this as a steering-semantics change.
- Bare `pause` and `run pause` both yield `unknown_verb`; there is no dock mirror of retired CLI `run pause` — rules out reintroducing pause, a partial `run` dispatch for `pause`, or a distinct error code for the CLI-shaped typo.

## Work

- Replace single-token verb routing in `parseTuiCommand` with `pipeline` / `run` subcommand dispatch; move today's `parseStart` body under `pipeline start`.
- Hard-cut legacy bare verbs; map `run resume` → `{ kind: "resume-run" }`, `run kill` → `{ kind: "kill" }`, `run log` → `{ kind: "log" }`, pipeline steering kinds unchanged.
- Update `isRunSteeringCommandBuffer` and any dock hint strings that enumerate verbs (if present in touched files).
- Rewrite `tui-command-parser.test.ts` for CLI-aligned happy paths, `--detach` on `pipeline start`, hard-cut regressions, and trailing-token rejection on multi-token paths.
- Update `tui-entry.test.ts` command buffers to CLI-aligned forms; keep steering, admission, parse-failure, and buffer-retention scenarios equivalent.
- Documentation updates below.

## Acceptance criteria

- [x] `tui-command-parser.test.ts` test `parses CLI-aligned pipeline steering verbs` (new): `pipeline approve`, `pipeline reject`, and `pipeline resume` each parse to the same `kind` as today's bare `approve` / `reject` / `resume`; fails against the pre-fix parser (`unknown_verb` on `pipeline approve`).
- [x] `tui-command-parser.test.ts` test `parses CLI-aligned run steering verbs` (new): `run kill`, `run resume`, and `run log` parse to `{ kind: "kill" }`, `{ kind: "resume-run" }`, and `{ kind: "log" }` respectively; fails against the pre-fix parser.
- [x] `tui-command-parser.test.ts` test `parses pipeline start with CLI prefix` (new): `pipeline start jarvis --seed v2/spec/seeds/foo.md` and `pipeline start jarvis --seed-text "ship it"` match today's bare `start …` results; bare `start jarvis --seed …` yields `unknown_verb` after the change.
- [x] `tui-command-parser.test.ts` test `pipeline start accepts and ignores --detach` (new): `pipeline start jarvis --detach --seed path` and `pipeline start jarvis --seed path --detach` parse like the same command without `--detach`; fails against the pre-fix parser (`unknown_verb` on leading token `pipeline`; pre-fix never reaches start-flag parsing).
- [x] `tui-command-parser.test.ts` test `selection-scoped steering rejects trailing positionals` (new): `pipeline approve foo` and `run kill run-1` yield `unexpected_arguments`, pinning the no-explicit-id-on-dock rule for one pipeline verb and one run verb; fails against the pre-fix parser (`unknown_verb`).
- [x] `tui-command-parser.test.ts` test `legacy bare verbs are hard-cut` (new): bare `approve`, `kill`, `resume-run`, and `start jarvis --seed x` yield `unknown_verb`; fails against the pre-fix parser (those bare forms parse today).
- [x] `tui-command-parser.test.ts` test `pause is no longer a dock verb` stays green and asserts `run pause` → `unknown_verb` (extend test or adjacent case); post-fix pins the same code as bare `pause`.
- [x] `tui-command-parser.test.ts` test `expand` / `collapse` bare forms stay green (still parse with no arguments; trailing tokens still `unexpected_arguments`).
- [x] `tui-entry.test.ts` test `reports parser and admission failures without losing repairable command input` stays green after its sample buffers use CLI-aligned forms (parse-error and buffer retention unchanged).
- [x] `tui-entry.test.ts` run-steering and pipeline-steering dispatch tests stay green after their typed buffers use CLI-aligned forms (`run kill` / `run resume` instead of `kill` / `resume-run`; `pipeline approve` / `pipeline reject` / `pipeline resume` instead of bare names).
- [x] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/tui.md` § Dock commands — rewrite the verb table and prose to the CLI-aligned grammar, the selection-scoped (no positional ids) steering rule, hard-cut of legacy bare verbs, bare `expand`/`collapse`, and ignored `--detach` on `pipeline start`.
- `v2/docs/operator-runbook.md` — update the `jarvis tui` row and key-bindings paragraph verb list to the CLI-aligned forms.
- `v2/docs/v1-behaviors.md` — record the dock grammar realignment, hard-cut bare verbs, and that dock `pause` / `run pause` were not added (CLI `run pause` remains retired).
