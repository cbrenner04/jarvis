# Resume-path inventory uses shared parse-only locator binding

`workflow-runner-resume-inventory.test.ts` is the only self-parsing inventory locator in the `*-anchors` corpus (audit 2026-09-18). It still regex-parses merge-base file text with a prefix-blind first-match pattern and proves parity only by iterating whatever anchor count that parse returns, so a smaller wrong inventory stays green.

## Decision ledger

- Scope is `workflow-runner-resume-inventory.test.ts` inventory discovery/parsing only; rules out re-keying structural tests that already bind via `locateDiscoveredFile` or symbol slices.
- `parseResumePathInventoryAnchors` resolves array text through `locateParseOnlyInventoryArrayBody` from `shared/structural-test-locator.ts` using logical constant name `RESUME_PATH_INVENTORY_ANCHORS`; rules out keeping the in-file `(?:export\\s+)?const\\s+_?(?:RESUME_PATH_INVENTORY_ANCHORS|SOURCE_BUCKETS)` first-match regex as the binding path (reachable on main in `parseResumePathInventoryAnchors`).
- Module inventory `_RESUME_PATH_INVENTORY_ANCHORS` carries `PARSE_ONLY_INVENTORY_MARKER_COMMENT` imported from the shared locator module; rules out a hand-copied marker string.
- Co-located parser fixtures (including `parses resume-path inventory anchors from inventory test source`) use a constant name or placement the shared locator cannot select when resolving `RESUME_PATH_INVENTORY_ANCHORS`; rules out a same-shaped unmarked `SOURCE_BUCKETS` (or same-alias) block in module or fixture source that first-match regex would prefer over the marked module inventory.
- Merge-base parity asserts `discoverResumePathInventoryAnchors(mergeBase).length === _RESUME_PATH_INVENTORY_ANCHORS.length` in addition to existing leaf-title preservation; rules out `anchors.length > 0` or an unbounded `for (const anchor of anchors)` loop as sufficient proof of correct binding.
- Re-audit the `*-anchors` / self-parsing inventory corpus during implementation; if another locator appears on main, apply the same marker, shared binding, and count assertion in this subspec only when it is the same inventory-parse pattern—otherwise record it and stop (expected: no additional files).

## Task checklist

- Import `PARSE_ONLY_INVENTORY_MARKER_COMMENT` and `locateParseOnlyInventoryArrayBody` from `shared/structural-test-locator.ts`.
- Place the parse-only marker immediately above `_RESUME_PATH_INVENTORY_ANCHORS`.
- Refactor `parseResumePathInventoryAnchors` to obtain the array literal body via `locateParseOnlyInventoryArrayBody(inventorySource, "RESUME_PATH_INVENTORY_ANCHORS", …)` and retain `parseResumePathInventoryAnchorBlock` for element parsing.
- Reshape or relocate the `parses resume-path inventory anchors from inventory test source` fixture so it exercises element parsing without being bindable as the module inventory (wrong name, absent marker, or synthetic source that omits the marked module declaration).
- Extend `preserves merge-base resume-path leaf titles in workflow-runner-resume*.test.ts destinations` or add a dedicated test that fails on main when anchor count diverges from `_RESUME_PATH_INVENTORY_ANCHORS.length`.
- Update the file-header comment to record the 2026-09-18 `*-anchors` audit (only this file on main) and the shared parse-only binding contract.

## Acceptance criteria

- [ ] `_RESUME_PATH_INVENTORY_ANCHORS` in `v2/src/execution/workflow-runner-resume-inventory.test.ts` is immediately preceded by `PARSE_ONLY_INVENTORY_MARKER_COMMENT` imported from `shared/structural-test-locator.ts`.
- [ ] `parseResumePathInventoryAnchors` in `v2/src/execution/workflow-runner-resume-inventory.test.ts` binds merge-base and in-memory inventory source through `locateParseOnlyInventoryArrayBody` for `RESUME_PATH_INVENTORY_ANCHORS`, not the pre-fix prefix-blind `_?` first-match regex over `RESUME_PATH_INVENTORY_ANCHORS|SOURCE_BUCKETS` (reachable on main in the same file).
- [ ] A regression in `v2/src/execution/workflow-runner-resume-inventory.test.ts` (extended `preserves merge-base resume-path leaf titles in workflow-runner-resume*.test.ts destinations` or a dedicated bind/count test) fails on main and passes after the shared-helper binding, asserting parsed anchor count equals `_RESUME_PATH_INVENTORY_ANCHORS.length`, not only non-emptiness.
- [ ] The file-header comment on `v2/src/execution/workflow-runner-resume-inventory.test.ts` records the `*-anchors` self-parsing audit (2026-09-18): only this file on main, updated to the shared contract.
- [ ] `parses resume-path inventory anchors from inventory test source` in `workflow-runner-resume-inventory.test.ts` stays green with fixtures shaped so `locateParseOnlyInventoryArrayBody` cannot bind them as `RESUME_PATH_INVENTORY_ANCHORS`.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.
- [ ] `bun run test:integration:v2` passes.

## Documentation updates

None — durable author/operator prose is the separate docs intent.
