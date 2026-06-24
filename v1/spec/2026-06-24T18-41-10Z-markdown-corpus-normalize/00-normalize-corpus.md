# One-time normalize pass to green the lint gate

## Problem

`bun run lint:md` exists with a house-style config (`.markdownlint-cli2.jsonc`)
but the in-scope corpus does not yet satisfy it, so the lint step cannot be a
green gate. Normalize the corpus once so the gate passes clean. The change is
isolated to its own PR for reviewer clarity — formatting separated from logic —
not because the diff is large; the violation count is modest.

## Scope

In-scope = the config's `globs` minus its `ignores`: `v1/spec/**/*.md`,
`v1/docs/**/*.md`, `reports/**/*.md`, `README.md`, `AGENTS.md`; excluding
`**/completed/**` and `**/node_modules/**`. Do not change the corpus the gate
covers: leave `globs` as-is, and do not add/remove durable-corpus files via
`ignores`.

## Decisions

- Drive the bulk via `markdownlint-cli2 --fix`, then hand-fix the residual non-autofixable violations. Rules out a hand-only pass that diverges from the linter's own normalization.
- The only mechanical edits that can appear are the rules that actually fire and autofix: blank lines around headings, list indentation and marker spacing, collapsing consecutive blank lines, final newline. `--fix` produces no line-wrapping or trailing-whitespace edits — `MD013` and `MD009` are disabled in the config. Rules out grading the diff against impossible categories.
- Exempt generated plan-review artifacts (`**/verdict-*.md`) by adding them to config `ignores`, same treatment as `**/completed/**` and `**/node_modules/**`. They regenerate on every plan resume, so normalizing them is non-durable churn that re-breaks the gate; they are also the largest cluster of non-autofixable structural violations. Honors the intent's generated-files exemption. Rules out normalizing regenerated files.
- Non-autofixable violations remaining in the durable corpus (e.g. missing/duplicate H1, broken link fragments) are cleared by disabling the offending rule in config — a rule-disable, not a scope change. Rules out making structural/content edits to satisfy the gate, which would violate the mechanical-only contract. Permitted config edits are limited to generated-artifact `ignores` and rule-disables; `globs` and the durable-corpus membership of `ignores` stay fixed.
- Frozen `**/completed/**` history stays untouched — already excluded by config `ignores`; do not modify those files even incidentally.
- Do not add a convenience script or alter `package.json` — out of scope; the existing `lint:md` is the gate.

## Task checklist

- [ ] If the first `bun run lint:md` fails module-not-found, run `bun install` first — that is environmental, not a lint failure.
- [ ] Add `**/verdict-*.md` to config `ignores`.
- [ ] Run `markdownlint-cli2 --fix` over the in-scope corpus, then disable any rule whose residual violations are not mechanically fixable.
- [ ] Confirm no `**/completed/**` or `node_modules` file changed, and no durable-corpus file was content-edited by hand.
- [ ] Confirm every changed corpus line falls into an enumerated mechanical category.

## Acceptance criteria

- [x] `bun run lint:md` exits 0.
- [x] No file under any `**/completed/**` path is modified by this change.
- [x] `package.json` is unchanged. The only `.markdownlint-cli2.jsonc` edits are adding generated-artifact patterns to `ignores` and disabling non-mechanically-fixable rules; `globs` and the durable-corpus membership of `ignores` are unchanged.
- [x] Every changed line in a durable-corpus file falls into a mechanical category that an enabled rule autofixes (blank lines around headings, list indentation/marker spacing, collapsed consecutive blank lines, final newline) — verifiable by inspecting the diff against this category list. No prose, ordering, or content edits.

## Documentation updates

None — purely mechanical formatting plus a generated-artifact lint exemption,
with no behavior, workflow, or operator-facing semantic change. No
`v2/docs/v1-behaviors.md` entry (no v1 behavior changes).
