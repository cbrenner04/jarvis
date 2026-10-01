# Self-parsing inventory locator operator and author docs

## Problem

Authors and operators have no durable guidance that a green structural inventory test can be validating a fixture, that parse-only constants need an explicit marker for lint autofix, or that anchor count must match the live inventory.

## Decisions

- Author contract lives in `v2/docs/test-writing.md` (new subsection under structural-invariant tests); operator gate-trust warning lives in `v2/docs/operator-runbook.md` § Gate trust — rules out a third doc that repeats the full locator rules.
- Canonical examples are `shared/structural-test-locator.ts`, `shared/structural-test-locator.test.ts`, and `v2/src/execution/workflow-runner-resume-inventory.test.ts`; rules out duplicating `v2/docs/structural-invariant-test-audit.md` inventory lists in prose.
- Document the marker via `PARSE_ONLY_INVENTORY_MARKER_COMMENT` (`// jarvis:parse-only-inventory`) and `locateParseOnlyInventoryArrayBody`; rules out treating a hand-copied comment string as the contract.
- Module inventory may use a `_`-prefixed `const` when Biome unused-rename applies; callers pass the logical constant name without the underscore — rules out telling authors to drop the prefix without the parse-only marker.
- Test fixtures belong in unprefixed same-named `const` blocks that omit the marker; prose must state that prefix-blind regex or non-empty parse output does not prove the module inventory was read — rules out “green test ⇒ correct bind” without anchor-count or marker checks.
- Anchor-count proof: tests should assert parsed anchor count matches the live module array (resume inventory `expect(anchors.length).toBe(_RESUME_PATH_INVENTORY_ANCHORS.length)`); rules out vacuous non-emptiness checks alone.

## Tasks

- Add a `### Self-parsing inventory locators` subsection to `v2/docs/test-writing.md` under `## Structural-invariant tests`: fixture placement vs marked module declaration, `_` prefix tolerance, import/use of `PARSE_ONLY_INVENTORY_MARKER_COMMENT` and `locateParseOnlyInventoryArrayBody`, why non-emptiness does not prove the right inventory was parsed, and anchor-count parity with the module array; link the shared helper tests and resume inventory test.
- Add a Gate trust bullet in `v2/docs/operator-runbook.md`: a green structural inventory suite may reflect a fixture bind — verify parsed anchor count against the live module inventory and cross-link the new test-writing subsection.
- Keep existing structural-invariant bullets; extend the fail-loudly bullet to mention `locateParseOnlyInventoryArrayBody` where appropriate without duplicating the subsection.

## Acceptance criteria

- [ ] `v2/docs/test-writing.md` includes a self-parsing inventory locator subsection covering fixture placement, `_` prefix tolerance, the parse-only marker, and anchor-count proof, with links to `shared/structural-test-locator.test.ts` and `workflow-runner-resume-inventory.test.ts`.
- [ ] `v2/docs/operator-runbook.md` § Gate trust includes a bullet that a green structural inventory test may be validating a fixture and operators should verify parsed anchor count against the live module inventory.
- [ ] `bun run lint:md` passes on `v2/docs/test-writing.md` and `v2/docs/operator-runbook.md`.

## Documentation updates

- `v2/docs/test-writing.md` — self-parsing inventory locator contract (fixture placement, prefix tolerance, marker, anchor count).
- `v2/docs/operator-runbook.md` — § Gate trust: structural inventory suite vs fixture bind.
