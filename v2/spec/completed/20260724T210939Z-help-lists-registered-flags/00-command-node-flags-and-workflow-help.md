# Command node flags and workflow help

## Problem

`jarvis help run workflow <preset>` prints a one-line `usage:` summary only. Workflow flags are not listed despite parsers accepting them.

## Decisions

- `CommandNode` carries an optional `flags` list (`name`, `argumentShape`, `description`); rules out a second flag registry that can drift from the tree.
- Help prints each flag as one stdout line `name<TAB>argumentShape<TAB>description` after the resolved usage line and before child `name<TAB>summary` subcommand lines; rules out folding flags into the usage prose string as the only discovery surface.
- Flag metadata is attached on each node that owns a parser; rules out inheriting flags from ancestors (usage fallback stays ancestor-only).
- `write` / `run start` flag sharing is out of scope here; workflow preset nodes only in this slice.

## Work

- Extend `CommandNode` and `renderHelpNode` to emit registered flags in the order declared on the node.
- Register every flag accepted by `parseIntentWorkflowArgs`, `parsePlanWorkflowArgs`, and `parseImplementWorkflowArgs` on the matching `run workflow` tree nodes.
- Add focused CLI help regressions for `help run workflow intent`, `plan`, and `implement`.

## Acceptance criteria

- [x] `jarvis help run workflow intent`, `jarvis help run workflow plan`, and `jarvis help run workflow implement` each list every parser-accepted flag with a non-empty description; stdout is otherwise unchanged aside from the new flag lines, stderr is empty, exit `0`.
- [x] `v2/src/cli.test.ts` workflow help regressions for `intent`, `plan`, and `implement` (named tests or one scoped group) each fail against the pre-fix tree and pass after registration.
- [x] Omitting one registered workflow flag from the tree while the parser still accepts it causes the workflow help regressions for all three presets above to fail.
- [x] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/v1-behaviors.md` — workflow preset help lists structured per-flag lines (format detail in `01`).
