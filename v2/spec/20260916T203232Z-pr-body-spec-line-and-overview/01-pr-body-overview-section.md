# PR body opens with Overview

## Problem

Implement PR bodies (`v2/src/execution/spec-run-body-summary.ts`) carry only Subspecs/Commits/Change summary and the narrative; nothing states what the PR delivers.

## Decisions

- Body's first `##` section is `## Overview`: the spec `index.md` opening paragraph (first paragraph under its H1) followed by each linked subspec's H1 title as a bullet — rules out copying whole index/subspec bodies.
- `## Subspecs` (title — why, from `renderTemplate` in `spec-run-body-summary.ts`) and `## Commits` are kept unchanged, not merged or removed — Overview's bare titles and Subspecs' title-plus-why lines carry distinct content.
- Full PR-body section order after the `Spec:` line: `## Overview` → `## Subspecs` (if any) → `## Commits` (if any) → `## Risk cues` (if flagged) → `## Change summary` → narrative block → attribution footer.
- Overview is derived from the spec tree on every render (same as other summary sections) so publication retries and `refreshPrBody` regenerate it.
- Index with no opening paragraph: omit the paragraph, keep subspec titles; no subspecs and no paragraph: omit the `## Overview` section entirely (first `##` section falls through to `## Subspecs` or whatever follows).
- Narrative marker preservation and precedence rules unchanged.

## Acceptance criteria

- [ ] A new test in `v2/src/execution/spec-run-body-summary.test.ts` asserts the rendered body's first `##` section is `## Overview` carrying the spec index opening paragraph and each subspec title, followed by `## Subspecs`; it fails against the pre-fix code.
- [ ] A new test in `v2/src/execution/spec-run-body-summary.test.ts` drives an index with no opening paragraph and asserts `## Overview` keeps the subspec-title bullets with no paragraph line.
- [ ] A new test in `v2/src/execution/spec-run-body-summary.test.ts` drives an index with no opening paragraph and no linked subspecs and asserts the rendered body omits `## Overview` entirely.
- [ ] `v2/src/execution/pr-body-refresh.test.ts` narrative-marker tests stay green.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` § PR body narrative markers and implement body summary — new section order (Overview first).
- `v2/docs/v1-behaviors.md` — note the Overview section in v2 PR bodies.
