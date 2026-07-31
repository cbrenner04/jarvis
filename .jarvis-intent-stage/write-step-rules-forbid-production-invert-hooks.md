---
name: write-step-rules-forbid-production-invert-hooks
---

# Plan and implement write-step rules forbid production invert hooks

## Problem

Plan drafts write "Inverting each added guard makes its regression RED" and agents satisfy it with
`setInvert*ForTest` exports, `invert*ForTest` module variables, or `invert*` production parameters —
bypass branches that let the real guard be deleted while mutation verification passes on plumbing.

## Decisions

- `DEFAULT_WRITE_STEP_RULES` names source mutation plus a comment checkpoint on the pinning test as the only acceptable guard-inversion evidence — rules out leaving the criterion prose implicit.
- The same block forbids `setInvert*ForTest`, `invert*ForTest` module variables, `invert*` function parameters, and `invert*ForTest` type members in production — rules out documenting only the export shape from #2323–#2328.
- A rendered-prompt test pins the new text in plan and implement write prompts — rules out fixing only `shared/prompts/step-rules.ts` without render coverage.

## Acceptance criteria

- [ ] `shared/prompts/step-rules.ts` states source mutation with a comment checkpoint for guard-inversion criteria and forbids production invert hooks in all four shapes; `v2/src/execution/write.test.ts` (or equivalent render test) fails against the pre-change rules.
- [ ] Inverting the pinned substring in the render test makes that test RED.
- [ ] `bun run typecheck` and scoped v2 tests for touched surfaces pass.

## Documentation updates

- `v2/docs/test-writing.md` — guard-inversion evidence is a source mutation with a comment checkpoint; production invert hooks are forbidden.

## Prerequisites

