# Named derivation-failure reasons

## Problem

`deriveGateAllowedPaths` (`v2/src/execution/ready-finalize.ts:843`) returns `Set<string> | undefined` and collapses seven distinct failures onto one bare `undefined`: `git diff` base...HEAD threw or returned null, the `git ls-files` untracked inventory threw or returned null, the spec scope was unresolvable, a spec-tree path failed validation, diff output was unparseable, untracked output was unparseable, and a collected path failed repo-relative validation. `enumerateSpecTreePaths` (`:816`) likewise returns `null` for three different causes. No caller can report which one happened.

## Decisions

- `deriveGateAllowedPaths` returns a discriminated result — allowed paths, or a named failure reason — rather than a parallel reason-returning function beside the existing one; rules out two derivation entry points drifting apart.
- Reason names, one per failure above: `diff_unavailable`, `untracked_inventory_unavailable`, `spec_scope_unresolvable`, `spec_tree_path_invalid`, `diff_output_unparseable`, `untracked_output_unparseable`, `collected_path_invalid`. `spec_scope_unresolvable` covers both an invalid spec path and a missing scope root, per the intent.
- `enumerateSpecTreePaths` returns its own reason instead of `null` so the two spec-scope causes stay separable inside the module; a `listSpecTreePaths` seam returning `null` maps to `spec_scope_unresolvable`, since an injected seam carries no cause.
- `spec_tree_path_invalid` and both `spec_scope_unresolvable` causes (invalid spec path, missing scope root) are unreachable through the injected `listSpecTreePaths` seam; tests drive them with real filesystem fixtures and assert each separately; rules out collapsing them into one reason.
- All three production call sites (`ready-finalize.ts:915`, `write-loop.ts:3546`, `write-loop.ts:4033`) and the `write-loop.test.ts` callers (`:5566, 6283, 6352, 6391, 6455, 6627, 6656`) adapt to the new shape with no change in what they do on failure; carrying the reason further is [01-log-derivation-reason-before-settlement.md](01-log-derivation-reason-before-settlement.md) and [02-published-lane-settles-honestly.md](02-published-lane-settles-honestly.md).
- The reason type is exported from `ready-finalize.ts`; the later subspecs log and classify it.

## Acceptance criteria

- [ ] A `ready-finalize.test.ts` test drives each of the seven failures and asserts its distinct named reason; no failure yields bare `undefined`. It fails against the pre-fix `Set<string> | undefined` return.
- [ ] The `toBeUndefined()` assertions at `ready-finalize.test.ts:303` and `:648,654,660` are updated to the discriminated result with the same outcomes (failure stays failure); the other derivation tests at `ready-finalize.test.ts:263-345` and `:620-665` and the `write-loop.test.ts` callers stay green (behavior at each call site unchanged by this subspec).
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

None. This subspec changes an internal return shape with no operator-facing or runtime behavior change; the operator-facing docs land with [01-log-derivation-reason-before-settlement.md](01-log-derivation-reason-before-settlement.md) and [02-published-lane-settles-honestly.md](02-published-lane-settles-honestly.md).
