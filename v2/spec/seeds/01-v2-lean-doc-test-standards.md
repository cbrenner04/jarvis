---
name: v2-lean-doc-test-standards
---

# Lean doc-comment and daemon-test standards

Amend the two v2 standards that generate weight, before shrink or feature work lands: `documentation-standard.md` mandates full contract JSDoc on every export (~200–250 lines of narration in v2 src today), and `test-writing.md`'s worked example blesses socket-wired daemon handler tests (85/544 test cases silently skip in the agent sandbox).

## Decisions

- `v2/docs/documentation-standard.md`: default is **one line per export, only where the contract isn't evident from the name and type**. Full blocks (`@throws`, `@invariant`, params/returns) only for genuinely non-obvious contracts. Explicitly forbid restating types or narrating bodies.
- `v2/docs/test-writing.md`: **direct handler invocation is the default** for daemon behavior tests — call the handlers returned by `createRunControlHandlers`/`createTailStreamHandler` in-process. Socket round-trips are limited to: (a) the `ipc.test.ts` transport suite, (b) at most 1–2 round-trip smokes per handler set (JSON marshaling proof), (c) `.sandbox-unrunnable` smokes. Replace the current worked example (which wires handlers through `startIpcServer`) accordingly.
- Add to the determinism smell checklist: a new agent-runnable test gated on `skipIf(!canUseUnixSockets())` is a defect unless it is one of the retained round-trip smokes.
- Docs-only change; no code.

## Out of scope

- Applying the new standards to existing code/tests (seeds 02–04, 10–12).
- Lint/automation enforcement of either standard.

## Ordering

01 — first; every later seed (02–13, including design seeds 05–09) is written and reviewed against these standards.
