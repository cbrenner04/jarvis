---
name: resume-path-inventory-binds-real-declaration
---

# Resume-path inventory guard parses merge-base anchors from the real declaration

## Problem

`workflow-runner-resume-inventory.test.ts` is the only self-parsing locator in the `*-anchors` corpus (audit 2026-09-18). It still uses first-match regex over merge-base source, keeps a same-shaped fixture in-file, and asserts parity with a `for (const anchor of anchors)` loop without fixing expected anchor count — so a smaller wrong inventory stays green.

## Behavior

- `discoverResumePathInventoryAnchors` / `parseResumePathInventoryAnchors` route inventory extraction through the shared self-parsing inventory helper and the parse-only marker contract.
- The in-file parser fixture is placed or shaped so the production locator cannot select it; merge-base parity asserts the parsed anchor count matches the live module inventory (not merely non-empty).
- Any other self-parsing locator found while auditing the `*-anchors` corpus gets the same count assertion and binding rules (expected: none beyond this file on main).

## Decisions

- Scope is execution-loop inventory tests only; rules out re-keying unrelated structural tests that already use `locateDiscoveredFile` / symbol slices.
- Anchor count is the proof the right declaration was parsed; rules out "anchors.length > 0" as sufficient.

## Prerequisites

- Shared self-parsing inventory locator throws on wrong binding, tolerates `_` prefix, and is covered by the three regressions in `shared/structural-test-locator.test.ts`.
- Parse-only inventory constants use the marker comment literal exported from the shared locator module.

## Acceptance criteria

- [ ] `_RESUME_PATH_INVENTORY_ANCHORS` carries the parse-only inventory marker literal exported from `shared/structural-test-locator.ts`.
- [ ] Merge-base inventory parsing binds the module `_RESUME_PATH_INVENTORY_ANCHORS` (or `SOURCE_BUCKETS` alias), not a same-shaped in-file fixture; binding fails against the pre-fix prefix-blind `_?` first-match regex in `parseResumePathInventoryAnchors` (reachable on main).
- [ ] A regression in `workflow-runner-resume-inventory.test.ts` (`preserves merge-base resume-path leaf titles in workflow-runner-resume*.test.ts destinations` extended or a dedicated bind/count test) fails on main and passes after shared-helper binding with anchor count equal to `_RESUME_PATH_INVENTORY_ANCHORS.length` (not only non-emptiness).
- [ ] The file-header comment on `workflow-runner-resume-inventory.test.ts` records the `*-anchors` self-parsing audit (2026-09-18): only this file on main, updated to the shared contract.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- None — durable author/operator prose is the docs intent.
