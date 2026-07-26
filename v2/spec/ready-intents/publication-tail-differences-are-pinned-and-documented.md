---
name: publication-tail-differences-are-pinned-and-documented
---

# The three publication tails' differences are pinned by tests and named in docs

## Problem

`publishWithReadyRepair` has three surrounding tails in `v2/src/execution/workflow-runner.ts`: the
primary `executeWorkflow` completion tail, `resumePopulatedIntentPublication`, and
`resumeReviewMutationFinalization`. They diverge on commit-before-publish handling, body-summary
derivation, `specTemplate`, settlement (`setRunStatus` vs `commitCompletionBoundary`), attempt/work
boundary recording, and which outcomes are settled `resumable`. Nothing records which of those
differences is intentional, so any consolidation would be a refactor against assumed equivalence.

## Behavior

Each tail's currently-shipped behavior on those axes is asserted by tests that fail if it changes,
and `v2/docs/workflow-runner.md` names the per-path differences and which are intentional.

## Decisions

- Characterization-only: pin current behavior, change none of it. Rules out fixing a divergence here
  and losing the before/after baseline the consolidation needs.
- Cover every axis that a shared tail would have to parameterize: commit-first, body summary,
  `specTemplate`, settlement mechanism, `resumable`, runtime-smoke and boundary emission. Rules out a
  thin smoke pin that lets an unpinned axis drift silently during extraction.
- Document the differences in `v2/docs/workflow-runner.md`, marking each intentional or accidental.
  Rules out carrying the enumeration only in a spec that disappears once merged.
- Out of scope: extracting shared code; changing any tail's behavior.

## Acceptance criteria

- [ ] Tests assert each of the three tails' commit-before-publish, body-summary, `specTemplate`,
      settlement, and `resumable` behavior; each fails when that tail's behavior is altered.
- [ ] `v2/docs/workflow-runner.md` lists the three tails and their differences, each marked
      intentional or accidental.
- [ ] No production behavior changes: `v2/src/execution/workflow-runner.test.ts` passes unmodified.

## Documentation updates

- `v2/docs/workflow-runner.md` — the three publication tails and their per-path differences.

## Prerequisites
