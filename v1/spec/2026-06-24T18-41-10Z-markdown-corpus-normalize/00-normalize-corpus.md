# One-time normalize pass to green the lint gate

## Problem

`bun run lint:md` exists with a house-style config (`.markdownlint-cli2.jsonc`)
but the in-scope corpus does not yet satisfy it, so the lint step cannot be a
green gate. Normalize the corpus once, mechanically, so the gate passes clean.

## Scope

In-scope = the config's `globs` minus its `ignores`: `v1/spec/**/*.md`,
`v1/docs/**/*.md`, `reports/**/*.md`, `README.md`, `AGENTS.md`; excluding
`**/completed/**` and `**/node_modules/**`. Do not edit the config to widen or
narrow this — the config is the contract.

## Decisions

- Mechanical-only diff: whitespace, list/heading markers, table alignment, blank-line normalization. No prose edits, no reordering, no content changes — rules out smuggling logic/wording changes into a formatting PR.
- Drive the bulk via `markdownlint-cli2 --fix` over the in-scope globs, then hand-fix the residual non-autofixable violations. Rules out a hand-only pass that diverges from the linter's own normalization.
- Frozen `**/completed/**` history stays untouched — already excluded by config `ignores`; do not modify those files even incidentally.
- Do not add a new convenience script or alter `package.json` — out of scope; the existing `lint:md` is the gate.

## Task checklist

- [ ] Run the autofix pass over the in-scope corpus, then resolve remaining violations by hand.
- [ ] Confirm no `**/completed/**` or `node_modules` file changed.
- [ ] Confirm the diff is mechanical formatting only.

## Acceptance criteria

- [ ] `bun run lint:md` exits 0 over the in-scope corpus.
- [ ] No file under any `**/completed/**` path is modified by this change.
- [ ] `.markdownlint-cli2.jsonc` and `package.json` are unchanged.
- [ ] The diff contains only mechanical formatting changes (line-wrapping, heading/list markers, table alignment, trailing whitespace, blank lines) — no prose, ordering, or content changes.

## Documentation updates

None — purely mechanical formatting with no behavior, workflow, or
operator-facing semantic change. No `v2/docs/v1-behaviors.md` entry (no v1
behavior changes).
