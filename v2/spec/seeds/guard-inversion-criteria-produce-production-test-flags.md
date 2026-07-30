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

The repo already has the better pattern: a comment checkpoint on the pinning test naming the
mutation, verified by mutation rather than by a production bypass branch
(`daemon-workflow-start.test.ts`, `workflow-runner.test.ts`).

## Decisions

- Guard-inversion evidence is a source mutation against the real guard, never a production
  bypass branch or exported test setter — rules out `setInvert*ForTest` as an acceptable way to
  satisfy an inversion criterion.
- The write-step rules injected into plan and implement state this explicitly, so an agent
  drafting or satisfying an inversion criterion reaches for the comment checkpoint — rules out
  fixing only the already-shipped instances.
- A static guard rejects new `setInvert*ForTest` exports (and `invert*ForTest` module variables)
  outside `**/*.test.ts`, running under `bun run check` alongside the existing guards — rules out
  relying on review to catch the next one.
- The guard allows the flags already on `main` only if removing them is out of scope for this
  spec; prefer removing them in the same change so the guard needs no allowlist.

## Acceptance criteria

- [ ] `scripts/guard-production-test-flags.ts` fails on a fixture exporting
      `setInvertFooForTest` from a non-test file under `v2/src/**`, `v1/src/**`, or `shared/**`,
      and passes on the same symbol inside a `.test.ts` file; it runs as part of `bun run check`.
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
