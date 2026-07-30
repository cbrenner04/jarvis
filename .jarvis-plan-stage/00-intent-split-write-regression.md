# Exercise surface splitting through the write step

## Problem

Prompt-only assertions do not prove the production intent write step preserves multi-surface fan-out
or single-surface output in `.jarvis-intent-stage/`.

## Decisions

- Build the production `intent` preset from committed file seeds and execute its returned write step
  through `executeWrite` — rules out direct prompt-renderer tests and hand-authored staged trees.
- Use a deterministic invocation binding whose fixture output follows the rendered prompt contract —
  rules out unconditional expected files that stay green against the pre-change prompt.
- Inspect each staged intent's title or body for its surface identity — rules out file-count-only
  coverage.
- Run multi-surface and single-surface seeds through one shared harness — rules out divergent setup
  that bypasses the split step for either case.

## Tasks

- Add committed Markdown seeds for a persistence → daemon → CLI fix and a genuinely single-surface
  fix.
- Add an agent-runnable intent-split regression harness using `buildIntentWorkflowSteps`,
  `executeWrite`, the shared write fixtures, and a stub invocation binding.
- Assert the post-write `.jarvis-intent-stage/` layout and intent bodies for both seeds.

## Acceptance criteria

- [ ] `v2/src/execution/intent-split-regression.test.ts` test `multi-surface seed fans out by surface
      through the production split write` drives the committed multi-surface seed through the built
      split write step and finds at least three separate staged intents identifying persistence,
      daemon, and CLI; it fails against the pre-change prompt.
- [ ] `v2/src/execution/intent-split-regression.test.ts` test `single-surface seed stays whole through
      the production split write` drives the committed single-surface seed through the same harness
      and finds exactly one staged intent with a one-line body rationale explaining why splitting
      does not apply; it fails against the pre-change prompt.
- [ ] Inverting the multi-surface fan-out contract to the pre-change one-intent path turns
      `multi-surface seed fans out by surface through the production split write` RED.
- [ ] The regression uses only injected bindings and filesystem fixtures; it starts no live model,
      daemon, or OS subprocess.

## Documentation updates

- None — `v2/docs/workflow-runner.md` already owns the operator contract.
