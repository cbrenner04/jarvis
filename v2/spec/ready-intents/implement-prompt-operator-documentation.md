---
name: implement-prompt-operator-documentation
---

# Implement prompt operator documentation

## Primary implementation surface

- Operator prompt documentation in `v2/docs/prompts.md`

## Prerequisites

- Implement-owned artifacts, v1 id wiring, and v2 id wiring are landed — registry, call sites, and render paths match `implement.prompt.body` / `implement.rules`.

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
