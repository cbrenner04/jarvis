# `jarvis runbook add` appends a learning in place

## Problem

After `jarvis init` scaffolds `OPERATOR_RUNBOOK.md`, the costly lessons an operator
learns mid-session (gotchas, workarounds) have no home but hand-editing, so the
runbook decays. The operator needs to append a freshly-learned entry into the right
runbook section in place, optionally tagged with its jarvis issue URL.

## Decisions

- New `jarvis runbook add` subcommand; not folded into `init`/`triage` — no existing flow curates the runbook post-init (`init` scaffolds once, `triage` is worktree-scoped).
- Default target section `## Known gotchas`; `--section <heading>` overrides among the scaffold's stable headings — rules out always-Known-gotchas (can't route a gate/cross-repo learning, forcing the hand-edit this replaces) and free-form section creation (would drift the stable heading set in `runbook-generator.ts`).
- `--section` matches a stable heading by its text (no leading `##`), case-insensitive; unknown section errors and lists valid headings.
- Append the entry as a new list item at the end of the target section (before the next `## ` heading or EOF); never overwrite or reorder existing content — rules out prepend/replace.
- Missing `OPERATOR_RUNBOOK.md` errors and points to `jarvis init`; does not scaffold — `init` owns scaffolding, silent create would mask a misconfigured cwd.
- Resolve the project (and thus the runbook path) via `findProjectMatchForPath(cwd)`, matching `cleanup`/`triage` — rules out cwd-relative path guessing.
- `--issue-url <url>` renders the URL as a markdown link inside the appended item, matching the existing gotcha-bullet style in the scaffold.

## Task checklist

- [ ] Add a `runbook` subcommand to the CLI (`Subcommand`, `ParsedArgs`, `parseArgs`, dispatch in `run()`), with the `add` action, a positional entry argument, and `--section` / `--issue-url` flags.
- [ ] Add a `runbook` command module that resolves the project, reads `OPERATOR_RUNBOOK.md`, inserts the rendered entry at the end of the target section, and writes the file in place.
- [ ] Cover the behaviors below with tests.
- [ ] Update `USAGE` help text and `v1/docs/operator-runbook.md` and `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [ ] `jarvis runbook add "<entry>"` inserts `<entry>` as a new markdown list item at the end of the `## Known gotchas` section of the project's `OPERATOR_RUNBOOK.md`, leaving every other section and existing bullet unchanged.
- [ ] `--section <heading>` (case-insensitive, stable-heading text without `##`) routes the entry to that section instead; an unknown or non-stable heading exits 1 and lists the valid section headings, writing nothing.
- [ ] `--issue-url <url>` includes `<url>` as a markdown link within the appended list item.
- [ ] Running two `runbook add` invocations appends two distinct list items; the first entry is preserved.
- [ ] Run outside any registered project exits 1 with a message naming `jarvis init`, matching `cleanup`/`triage` resolution.
- [ ] A project whose `OPERATOR_RUNBOOK.md` is absent exits 1 directing the operator to `jarvis init`, and does not create the file.
- [ ] Missing entry text exits 1 with usage for `runbook add`.
- [ ] `jarvis runbook --help` and the top-level `USAGE` list the `runbook add` command.

## Documentation updates

- `USAGE` string in `v1/src/cli.ts` lists `runbook add` with its flags.
- `v1/docs/operator-runbook.md` documents `jarvis runbook add` under the runbook-maintenance responsibility (default section, `--section`, `--issue-url`, missing-runbook behavior).
- `v2/docs/v1-behaviors.md` catalogs the new `jarvis runbook add` command as user-observable v1 behavior.
