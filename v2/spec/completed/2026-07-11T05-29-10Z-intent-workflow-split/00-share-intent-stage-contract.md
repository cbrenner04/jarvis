# Share the intent stage contract

Extract v1 intent-stage repair and validation for v1 and v2 without changing v1 behavior.

## Decisions

- Share filename/layout, frontmatter, first-H1, prerequisites, issue-reference, and Markdown-autofix behavior; rule out a partial v2 rewrite or divergent validators.
- Accept only a non-empty flat set of `.md` files whose unique filenames are non-reserved kebab-case slugs; rule out `index`, ordering prefixes, nested paths, and non-Markdown artifacts.
- Repair missing or mismatched `name:`, the first body H1, missing exact `## Prerequisites`, exact-heading spacing, line-start issue references, and v1 Markdown autofixes; rule out inventing malformed prerequisite prose or rewriting near-miss headings.
- Preserve v1 warning-only Markdownlint spawn/missing-binary behavior; rule out making tool availability a new validation failure.

## Task checklist

- Extract the v1 stage gate, deterministic repairs, and content validation behind a shared contract.
- Keep the v1 command on the shared contract.
- Add focused shared tests and retain the existing v1 intent suite as the parity anchor.

## Acceptance criteria

- [x] Shared validation accepts one or more non-empty valid intents with matching kebab-case filename/frontmatter name, a first body H1, and exact `## Prerequisites`.
- [x] Shared repair matches v1 for frontmatter names, first-H1 insertion/replacement, prerequisites insertion/spacing, issue references, and Markdown autofix.
- [x] Empty output, invalid or duplicate names, nested/non-Markdown output, malformed frontmatter, and malformed prerequisites remain hard errors.
- [x] `v1/test/intent-command.test.ts` and `v1/test/intent-command.sandbox-unrunnable.test.ts` stay green (behavior unchanged by extraction).

## Documentation updates

- None — purely internal extraction; v1 behavior is unchanged.
