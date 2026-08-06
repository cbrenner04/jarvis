---
name: authored-markdown-no-hard-wrap-lint
---

# Authored markdown no-hard-wrap lint and corpus reflow

## Problem

Hard-wrapped authored markdown still fails `lint:md` once a rule exists, and the ready gate runs `lint:md` on the lint-covered corpus. A rule without a deterministic reflow would leave the gate red; agent-hand reflow is non-repeatable.

## Decisions

- Add a `markdownlint-cli2` custom rule that flags a soft line break inside paragraph or list-item text on the markdown token stream — rules out a line-regex rule.
- Exempt fenced code blocks, tables, HTML blocks, YAML front-matter, and explicit hard breaks (trailing backslash or two trailing spaces) — rules out blanket no-wrap lint.
- Ship a committed deterministic AST reflow script under `scripts/` that joins wrapped paragraph and list-item lines and leaves code blocks, tables, front-matter, and reference-link definitions byte-identical — rules out agent-hand corpus edits.
- Land the custom rule and corpus reflow in the same change — rules out an intermediate ready-gate red between rule-only and reflow-only commits.
- `MD013` stays `false` — rules out a max-length rule.
- Corpus scope follows existing `.markdownlint-cli2.jsonc` globs and ignores (`**/completed/**`, `**/verdict-*.md` excluded) — rules out touching generated or ignored markdown.

## Acceptance criteria

- [ ] `.markdownlint-cli2.jsonc` loads a custom rule that flags intra-paragraph and intra-list-item soft line breaks; unit tests cover each exemption and a positive detection, and fail against the pre-fix config.
- [ ] A committed reflow script reflows the lint-covered corpus; `bun run lint:md` reports zero errors on the reflowed corpus, and re-running the script is a no-op.
- [ ] Mutation checkpoint: the custom rule's positive-detection test carries a `// @mutate` directive that disables detection; applying it turns that test RED.
- [ ] `bun run lint:md`, `bun run typecheck`, and the touched test scope pass.

## Documentation updates

- `v1/docs/spec-guidance.md` — record the no-hard-wrap convention; reconcile the "wrapping a pinning-test reference onto a continuation line is safe" note (parser still tolerates it; no longer authored style).
- `.markdownlint-cli2.jsonc` — comment the new custom rule.

## Prerequisites

- Global prompt fragment instructs agents not to hard-wrap authored markdown and composes into intent, plan, write, and patch step prompts.
- `bun run lint:md` lints markdown bounded by `.markdownlint-cli2.jsonc` globs and ignores.
