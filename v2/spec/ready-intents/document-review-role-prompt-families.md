---
name: document-review-role-prompt-families
---

# Document review-role prompt families

## Problem

`v2/docs/prompts.md` documents write-step and plan-draft prompts but omits the four review-role families (plan, patch, implement, intent) and their shared skeleton conventions after the terse convergence work.

## Decision ledger

- Add a review-role section to `v2/docs/prompts.md` covering plan, patch, implement, and intent families, the shared terse skeleton (role header, bare data blocks, short Rules), and which family is frozen vs actively converged; rules out duplicating per-role placeholder tables already owned by registry tests.
- Cross-link `workflow-runner.md` and `write-behavior.md` where review dispatch is already documented; rules out copying their execution contracts.

## Acceptance criteria

- [ ] `v2/docs/prompts.md` names all four review-role families, states the shared terse skeleton conventions, and records that patch review prompts are frozen v1 maintenance while plan and implement converged to the intent-family style.
- [ ] `bun run typecheck` passes.

## Documentation updates

- `v2/docs/prompts.md` — review-role families and shared skeleton conventions.

## Prerequisites

- Plan review role prompts are rewritten in intent-family terse style with load-bearing contracts preserved.
- Implement review role prompts are rewritten in intent-family terse style, patch-vs-implement divergence remains pinned, and `prompts/patch/review-*.md` are untouched.
