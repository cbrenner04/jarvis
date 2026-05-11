# Light spec migration

`jarvis run` should help users move non-compliant specs into the index-routed
shape instead of silently offering to run them as a one-shot. When pointed at a
non-`index.md` spec, jarvis should ask whether to switch to the sibling index
(if one exists), migrate the spec in place, or exit. Migration runs as a single
agent iteration that mechanically reshapes the spec per
[docs/spec-guidance.md](../../docs/spec-guidance.md) and stops.

This replaces the current "run anyway" escape hatch in
[src/commands/run.ts](../../src/commands/run.ts).

## Subspecs

- [x] [00 — Non-index run prompt](./00-non-index-run-prompt.md)
- [x] [01 — Migration run mode](./01-migration-run-mode.md)
- [x] [02 — Documentation updates](./02-documentation-updates.md)

## Conventions

- Run this spec with `jarvis run spec/light-spec-migration/index.md`.
- Complete one subspec per iteration. Do not bundle.
- If the subspec is blocked, append a `## Blocker` section to that file and
  stop.
