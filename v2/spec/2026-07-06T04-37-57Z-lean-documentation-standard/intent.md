---
name: lean-documentation-standard
---
# Lean Documentation Standard

# Lean doc-comment standard

Amend `v2/docs/documentation-standard.md` so the default is one line per export, only where the contract isn't evident from name and type. Full contract blocks (`@throws`, `@invariant`, params/returns) are reserved for genuinely non-obvious contracts. Explicitly forbid restating types or narrating bodies. Docs-only; no code changes.

## Prerequisites
