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
- Parse-only inventory constants use the marker comment contract defined alongside the shared helper.

## Acceptance criteria

- [ ] `workflow-runner-resume-inventory.test.ts` resolves merge-base `RESUME_PATH_INVENTORY_ANCHORS` (or `SOURCE_BUCKETS`) from the real module declaration when an in-file fixture of the same shape exists; a regression fails if first-match regex returns the fixture count instead of the live inventory count.
- [ ] The resume-path inventory parity test asserts expected anchor count equal to the live `_RESUME_PATH_INVENTORY_ANCHORS` length, not only non-emptiness.
- [ ] Audit of self-parsing locators under the `*-anchors` corpus is recorded (in test or comment): only `workflow-runner-resume-inventory.test.ts` on main, updated to the contract.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- None — durable author/operator prose is the docs intent.
