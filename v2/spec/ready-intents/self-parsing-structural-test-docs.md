---
name: self-parsing-structural-test-docs
---

# Document the self-parsing structural-test locator contract

## Problem

Authors and operators have no durable guidance that a green structural inventory test can be validating a fixture, that parse-only constants need an explicit marker for lint autofix, or that anchor count must match the live inventory.

## Behavior

- `v2/docs/test-writing.md` documents fixture placement, optional `_` prefix tolerance, the parse-only inventory marker, and why non-emptiness does not prove the right inventory was parsed.
- `v2/docs/operator-runbook.md` § Gate trust warns that a green structural suite can reflect a fixture bind and to verify parsed anchor count against the live inventory.

## Decisions

- Docs cite the shared helper and resume inventory test as the reference implementation; rules out duplicating the full audit inventory in prose.

## Prerequisites

- Shared self-parsing inventory locator behavior is implemented and regression-tested in `shared/structural-test-locator.test.ts`.
- `workflow-runner-resume-inventory.test.ts` binds merge-base parsing to the real declaration and asserts expected anchor count.

## Acceptance criteria

- [ ] `v2/docs/test-writing.md` includes a self-parsing locator subsection covering fixture placement, `_` prefix tolerance, the parse-only marker, and anchor-count proof.
- [ ] `v2/docs/operator-runbook.md` § Gate trust includes a bullet that a green structural inventory test may be validating a fixture and operators should check parsed anchor count.
- [ ] `bun run lint:md` passes on the edited doc paths.

## Documentation updates

- `v2/docs/test-writing.md` — self-parsing locator contract (fixture placement, prefix tolerance, marker, anchor count).
- `v2/docs/operator-runbook.md` — § Gate trust: structural suite vs fixture bind.
