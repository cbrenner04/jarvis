---
name: intent-run-stem-honors-frontmatter-name
---

# `intent` run stem honors the seed's frontmatter `name:`

## Problem

When a seed is submitted as inline text, `deriveRunName` falls back to the first
6 words of the body, losing the frontmatter `name:` the operator authored. So an
inline submission gets an unstable, body-derived run stem instead of the intended
name.

## Direction

- Derive the run stem from the seed's frontmatter `name:` when present
  (a parser already exists: `parseIntentFrontmatterName`).
- Fall back to the existing behavior (file basename, or first-6-words for inline)
  only when no frontmatter `name:` is found.

## Out of scope

- Seeds-dir validation / commit-mode resolution.

## References

- `v1/src/commands/intent.ts` (`deriveRunName` ~L155, `parseIntentFrontmatterName` ~L187).

## Prerequisites
