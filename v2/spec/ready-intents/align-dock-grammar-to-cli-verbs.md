---
name: align-dock-grammar-to-cli-verbs
---

# The tui dock accepts the CLI command grammar minus `jarvis`

## Problem

`jarvis tui`'s dock verbs (`start`, `approve`, `reject`, `resume`, `kill`, `pause`, `resume-run`, `expand`, `collapse`, `log` in `v2/src/tui/tui-command-parser.ts`) diverge from the CLI grammar operators already know; typing `pipeline start …` parses as `unknown_verb`. Operators expect the shell command minus `jarvis`.

Unsplit rationale: the parser and its steering dispatch in `tui-entry.tsx` are one surface; a verb rename is unobservable without both.

## Decisions

- Dock verbs align to the CLI subcommand path minus `jarvis`: `pipeline start|approve|reject|resume`, `run kill|resume|log`. Rules out the bespoke names as the primary grammar.
- Plan must decide how selection-scoped shorthand coexists with the CLI grammar: full CLI form with explicit ids, an id-omitted form targeting the current selection, or both, per verb.
- Plan must decide alias-or-hard-cut for the old verb names (single-operator repo; muscle memory is real).
- Plan must decide whether `expand`/`collapse` stay bare or take a `view` namespace; they have no CLI analogue.
- The dock accepts and ignores `--detach` on `pipeline start` (dock steering is always detached) instead of today's `unknown_option` rejection.
- The dock `pause` verb is dropped, not mirrored, because `run pause` retires.
- Safety properties are unchanged: at-most-one in-flight admission, parse-error and selection-error feedback on `lastCommandResult`, buffer retention on failure. This is a parser and verb-naming change, not a steering-semantics change.

## Prerequisites

- `run pause` is retired from the CLI, so the dock has no `pause` verb to mirror (delivered by: retire-run-pause)

## Acceptance criteria

- [ ] `tui-command-parser.test.ts`: each CLI form (`pipeline start …`, `pipeline approve …`, `pipeline reject …`, `pipeline resume …`, `run kill …`, `run resume …`, `run log …`) parses to the same action the bespoke verb produces today; fails against the current parser (`unknown_verb`).
- [ ] `tui-command-parser.test.ts`: the chosen selection-vs-explicit-id rule is pinned for at least one pipeline verb and one run verb; `--detach` on `pipeline start` is accepted and ignored.
- [ ] `tui-command-parser.test.ts` and `tui-entry.test.ts`: parse-error, selection-error, and buffer-retention behavior is unchanged under the realigned grammar; `pause` is no longer a dock verb.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/tui.md` § Dock commands — rewrite the verb table to the CLI-aligned grammar, the selection-vs-explicit-id rule, and any retained aliases.
- `v2/docs/operator-runbook.md` — the `jarvis tui` row and key-bindings paragraph list the new verbs.
- `v2/docs/v1-behaviors.md` — record the dock grammar change and the dropped `pause` verb.

## Primary implementation surface

- `v2/src/tui/tui-command-parser.ts`
- `v2/src/tui/tui-entry.tsx`
