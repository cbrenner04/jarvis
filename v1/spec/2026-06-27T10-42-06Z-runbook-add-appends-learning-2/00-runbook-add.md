# `jarvis runbook add` appends a learning in place

## Problem

After `jarvis init` scaffolds `OPERATOR_RUNBOOK.md`, the costly lessons an operator
learns mid-session (gotchas, workarounds) have no home but hand-editing, so the
runbook decays. The operator needs to append a freshly-learned entry into the right
runbook section in place, optionally tagged with its jarvis issue URL.

## Decisions

- New `jarvis runbook add` subcommand; not folded into `init`/`triage` — no existing flow curates the runbook post-init (`init` scaffolds once, `triage` is worktree-scoped).
- Default target section `## Known gotchas`; `--section <heading>` overrides — rules out always-Known-gotchas (can't route a gate/cross-repo learning, forcing the hand-edit this replaces) and free-form section creation (would drift the stable heading set).
- The valid `--section` set is the flat-bullet-list-containing subset of the scaffold's stable headings, exactly: `Known gotchas`, `Gate blind spots`, `Cross-repo coordination` — rules out the table/key-value/prose `##` sections (`Project facts`, `Spec layout`, `Repos and gates`, `Sandbox and network`, `Manual finalize and recovery`, `Resume-first guidance`), where appending a flat list item produces malformed content.
- The authoritative heading set is the fixed section list rendered by `generateOperatorRunbook` in `v1/src/runbook-generator.ts`; the valid-section subset is derived from / kept consistent with it, so tests enumerate it from one source — rules out hardcoding a divergent list.
- `--section` matches a valid heading by its text (no leading `##`), case-insensitive; an unknown or non-valid heading exits 1 and lists the valid headings, writing nothing.
- Append the entry as a new list item at the end of the target section (before the next `##` heading or EOF); never overwrite or reorder existing content — rules out prepend/replace.
- Rendered entry format is exactly `- <entry>` with no `--issue-url`, and `- <entry> ([jarvis issue](<url>))` with it — a single fixed shape so implementation and tests share one target; rules out per-implementer bullet/link variation.
- Missing `OPERATOR_RUNBOOK.md` errors and points to `jarvis init`; does not scaffold — `init` owns scaffolding, silent create would mask a misconfigured cwd.
- Resolve the project (and thus the runbook path) via `findProjectMatchForPath(cwd)`, matching `cleanup`/`triage` — rules out cwd-relative path guessing.
- Entry text is required; whitespace-only entry is treated as missing and exits 1 with usage (matching how `prompt` rejects blank input).
- `--issue-url` accepts any non-empty string with no format validation — rules out URL-shape parsing the operator can already get right; an empty `--issue-url` value exits 1 with usage, like missing entry text.
- Bare `jarvis runbook` (no action) and `jarvis runbook <unknown>` print `runbook` usage and exit 1, matching the other subcommands' unknown-action handling.

## Task checklist

- [ ] Add a `runbook` subcommand to the CLI (`Subcommand`, `ParsedArgs`, `parseArgs`, dispatch in `run()`), with the `add` action, a positional entry argument, and `--section` / `--issue-url` flags.
- [ ] Add a `runbook` command module that resolves the project, reads `OPERATOR_RUNBOOK.md`, inserts the rendered entry at the end of the target section, and writes the file in place.
- [ ] Write unit tests covering each acceptance criterion.
- [ ] Update `USAGE` help text and `v1/docs/operator-runbook.md` and `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [x] `jarvis runbook add "<entry>"` appends exactly the line `- <entry>` as a new list item at the end of the `## Known gotchas` section of the project's `OPERATOR_RUNBOOK.md`, leaving every other section and existing bullet unchanged.
- [x] `--issue-url <url>` makes the appended item exactly `- <entry> ([jarvis issue](<url>))`.
- [x] `--section <heading>` (case-insensitive, heading text without `##`) routes the entry to that section instead, for each of `Gate blind spots` and `Cross-repo coordination`; a heading outside the valid set `{Known gotchas, Gate blind spots, Cross-repo coordination}` (including a table/prose `##` heading like `Repos and gates`) exits 1 and lists the valid headings, writing nothing.
- [x] Running two `runbook add` invocations appends two distinct list items; the first entry is preserved.
- [x] Run outside any registered project exits 1 with a message naming `jarvis init`, matching `cleanup`/`triage` resolution.
- [x] A project whose `OPERATOR_RUNBOOK.md` is absent exits 1 directing the operator to `jarvis init`, and does not create the file.
- [x] Missing entry text, or whitespace-only entry text, exits 1 with usage for `runbook add` and writes nothing.
- [x] `--issue-url` with an empty value exits 1 with usage; any other non-empty value is accepted without format validation.
- [x] Bare `jarvis runbook` and `jarvis runbook <unknown-action>` each print `runbook` usage and exit 1.
- [x] `jarvis runbook --help` and the top-level `USAGE` list the `runbook add` command.

## Documentation updates

- `USAGE` string in `v1/src/cli.ts` lists `runbook add` with its flags.
- `v1/docs/operator-runbook.md` documents `jarvis runbook add` under the runbook-maintenance responsibility (default section, `--section`, `--issue-url`, missing-runbook behavior).
- `v2/docs/v1-behaviors.md` catalogs the new `jarvis runbook add` command as user-observable v1 behavior.
