---
name: implement-prompt-operator-documentation
---

# Implement prompt operator documentation

## Primary implementation surface

- Operator prompt documentation in `v2/docs/prompts.md`

## Prerequisites

- Fragment attachment is declared in artifact frontmatter (`behavior:`, `add:`, `remove:`) and honored by one assembler — rules out mislabeled silent attachment.
- Plan and implement review-role prompts use the intent-family terse skeleton — rules out re-editing those files during implement id migration.
- Implement write-step body and rules are registered as `implement.prompt.body` and `implement.rules` with implement vocabulary (no "Patch Mode") — rules out documenting retired patch ids as the live implement path.
- Generic implement rules artifact is target-repo-neutral; jarvis-repo-specific tool commands live in injected repo guidance — rules out documenting jarvis-specific rules as generic implement rules.
- No registered artifact's `behavior:` silently attaches fragments its step did not explicitly opt into; intent-split fragment set is declared via explicit `add:` — rules out documenting silent behavior-based attachment.
- v2 implement write path resolves `implement.prompt.body` and `implement.rules` at every production call site — rules out documenting `write.execute` or `patch.prompt.body` as the default implement prompt.
- v1 patch-mode rendering resolves `implement.prompt.body` and `implement.rules` by id — rules out documenting v1 as still on retired patch ids.

## Problem

- `v2/docs/prompts.md` claims `write.execute` is the default for plan/implement/standalone write and omits review families, fragment policy, and the live implement render path.

## Behavior

- `v2/docs/prompts.md` documents the live prompt corpus: per-workflow step prompts, review families, implement-owned ids, fragment frontmatter contract, ownership, and render paths — matching committed wiring.

## Decision ledger

- Full rewrite of `v2/docs/prompts.md` against the live registry; rules out incremental patches that leave wrong `write.execute` default claims.
- Cross-link `v2/docs/documentation-standard.md` and `v1/docs/prompt-governance.md` instead of duplicating fragment-policy prose; rules out two divergent ownership narratives.

## Acceptance criteria

- [ ] `v2/docs/prompts.md` documents `implement.prompt.body` / `implement.rules` as the implement write path, not `write.execute` or `patch.prompt.body`.
- [ ] `v2/docs/prompts.md` includes implement and plan review-role families and the fragment frontmatter contract (`behavior:`, `add:`, `remove:`).
- [ ] `bun run typecheck` passes; no test script required (docs-only surface).

## Documentation updates

- `v2/docs/prompts.md` — full rewrite per above.
