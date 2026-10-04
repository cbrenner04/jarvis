---
name: align-dock-grammar-to-cli-verbs
---

# The tui dock accepts the CLI command grammar minus `jarvis`

## Problem

`jarvis tui`'s dock verbs (`start`, `approve`, `reject`, `resume`, `kill`, `pause`, `resume-run`, `expand`, `collapse`, `log` in `v2/src/tui/tui-command-parser.ts`) diverge from the CLI grammar operators already know; typing `pipeline start …` parses as `unknown_verb`. Operators expect the shell command minus `jarvis`.

Unsplit rationale: the parser and its steering dispatch in `tui-entry.tsx` are one surface; a verb rename is unobservable without both.

## Decisions

- Primary dock grammar is the CLI subcommand path minus `jarvis`: `pipeline start|approve|reject|resume`, `run kill|resume|log` — rules out bespoke bare verbs as primary grammar.
- Legacy bare verbs hard-cut to `unknown_verb` with no compatibility aliases — rules out dual grammars.
- Steering accepts only the CLI subcommand token path with no target positionals; dispatch uses current selection like today's zero-arg bespoke verbs — rules out dock parsing of shell id positionals.
- Trailing tokens after a recognized steering path yield `unexpected_arguments` — rules out silently ignoring typed ids.
- `expand` and `collapse` stay bare one-word verbs with no `view` namespace — rules out a CLI-less namespace.
- `pipeline start` accepts optional `--detach` among start flags and ignores it — rules out `unknown_option` for shell-copied `--detach`.
- Bare `pause` and `run pause` yield `unknown_verb`; no dock mirror of retired CLI `run pause`.
- Safety properties unchanged: at-most-one in-flight admission, parse-error and selection-error feedback on `lastCommandResult`, buffer retention on failure — parser and verb-naming change only, not steering semantics.

## Prerequisites

- `run pause` is retired from the CLI, so the dock has no `pause` verb to mirror (delivered by: retire-run-pause)

## Acceptance criteria

- [ ] `tui-command-parser.test.ts`: each CLI form (`pipeline start …`, `pipeline approve …`, `pipeline reject …`, `pipeline resume …`, `run kill …`, `run resume …`, `run log …`) parses to the same action the bespoke verb produces today; fails against the current parser (`unknown_verb`).
- [ ] `tui-command-parser.test.ts`: selection-scoped steering (no positional ids) pinned for at least one pipeline verb and one run verb; `--detach` on `pipeline start` accepted and ignored; `run pause` → `unknown_verb`.
- [ ] `tui-command-parser.test.ts` and `tui-entry.test.ts`: parse-error, selection-error, and buffer-retention behavior unchanged under the realigned grammar; bare `pause` remains `unknown_verb`.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/tui.md` § Dock commands — rewrite the verb table to the CLI-aligned grammar, selection-scoped steering, hard-cut legacy bare verbs, bare `expand`/`collapse`, and ignored `--detach` on `pipeline start`.
- `v2/docs/operator-runbook.md` — the `jarvis tui` row and key-bindings paragraph list the new verbs.
- `v2/docs/v1-behaviors.md` — record the dock grammar change, hard-cut bare verbs, and that dock `pause` / `run pause` were not added (CLI `run pause` remains retired).

## Primary implementation surface

- `v2/src/tui/tui-command-parser.ts`
- `v2/src/tui/tui-entry.tsx`
