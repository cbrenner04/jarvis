---
name: guard-inversion-criteria-produce-production-test-flags
---

# Guard-inversion acceptance criteria produce production test flags

## Problem

Plan drafts routinely write "Inverting each added guard makes its regression RED" as an
acceptance criterion. Agents satisfy it by adding mutable module state plus a
`setInvert<Guard>ForTest` setter to production code, so the criterion passes while the real
guard can be deleted.

Observed 2026-07-30, one session:

- `20260730T071756Z-workflow-collapse-drops-test-flag` existed solely to delete one such flag
  (`setInvertWorkflowCollapseForTest`), shipped as #2326.
- `plan-split-preserves-draft-scope` (#2323) added `setInvertPartitionGuardForTest` in the same
  session.
- `pipeline-operator-cli` (#2328) added four: `setInvertPreAdmissionResolutionGuardForTest`,
  `setInvertDetachClientWaitGuardForTest`, `setInvertListNonFollowGuardForTest`,
  `setInvertWaitBoundaryGuardForTest`.

Recurred 2026-07-30 (later session) in a **parameter** shape the observations above miss:

- `#2359` added `invertSingleFileGuardForTest` / `invertFileGuardForTest` as optional
  production function parameters in `v2/src/execution/intent-output.ts`, satisfied by
  tautological tests that call the helper with the flag set and assert it returns the other
  value — proving nothing about the guard.
- `#2360` threaded `invertSidecarFence = false` through
  `validateReadyGateRepairCompletion` / `enforcePersistedReadyGateRepairFence` and
  `invertReadyGateRepairSidecarFenceForTest` through `WriteLoopInput`. The
  `options?.invertSidecarFence === true` plumbing line then **survived mutation
  verification** (`operator-flip: === → !==`, `write-loop.ts:476`), settling the run
  `surviving_mutation_failed`. Two `jarvis run resume` attempts reproduced it identically;
  recovery was a hand-written persisted-fence regression.

Neither shape is an export or a module variable, so a guard matching only
`setInvert*ForTest` exports and `invert*ForTest` module variables would have passed all of
them. The parameter shape is also the one that costs a run: every invert flag threaded
through production adds a boolean-comparison line with no behavioral test, which is exactly
what the mutation verifier flags.

The repo already has the better pattern: a comment checkpoint on the pinning test naming the
mutation, verified by mutation rather than by a production bypass branch
(`daemon-workflow-start.test.ts`, `workflow-runner.test.ts`).

## Decisions

- Guard-inversion evidence is a source mutation against the real guard, never a production
  bypass branch, exported test setter, or invert parameter/input field — rules out
  `setInvert*ForTest` **and** `invert*(ForTest)?` function parameters and type members as
  acceptable ways to satisfy an inversion criterion.
- The write-step rules injected into plan and implement state this explicitly, so an agent
  drafting or satisfying an inversion criterion reaches for the comment checkpoint — rules out
  fixing only the already-shipped instances.
- A static guard rejects new `setInvert*ForTest` exports, `invert*ForTest` module variables,
  `invert*` function parameters, and `invert*ForTest` type members outside `**/*.test.ts`,
  running under `bun run check` alongside the existing guards — rules out relying on review to
  catch the next one, and rules out a guard scoped to exports alone.
- The guard allows the flags already on `main` only if removing them is out of scope for this
  spec; prefer removing them in the same change so the guard needs no allowlist.

## Acceptance criteria

- [ ] `scripts/guard-production-test-flags.ts` fails on a fixture exporting
      `setInvertFooForTest` from a non-test file under `v2/src/**`, `v1/src/**`, or `shared/**`,
      and passes on the same symbol inside a `.test.ts` file; it runs as part of `bun run check`.
- [ ] The same guard fails on the parameter and input-field shapes: a non-test file declaring a
      function parameter named `invert*` / `*ForTest`, or a type member named `invert*ForTest`,
      under the same roots; a `.test.ts` fixture with the same names passes.
- [ ] Inverting the guard's file-extension check makes that regression RED.
- [ ] The plan and implement write-step rules name source mutation plus a comment checkpoint as
      the way to satisfy a guard-inversion criterion and forbid production test setters; a
      rendered-prompt test pins that text.
- [ ] `bun run check`, `bun run typecheck`, and the scoped test slices for touched surfaces pass
      with every existing `setInvert*ForTest` either removed or explicitly allowlisted with a
      named follow-up.

## Documentation updates

- `v2/docs/test-writing.md` — guard-inversion evidence is a source mutation with a comment
  checkpoint; production test flags are rejected by `bun run check`.
- `v2/docs/coding-standards.md` — no production state exists solely for tests.
