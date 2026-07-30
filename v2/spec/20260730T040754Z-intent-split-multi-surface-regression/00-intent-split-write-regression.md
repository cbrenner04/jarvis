# Exercise surface splitting through the write step

## Problem

Prompt-only assertions do not prove the production intent write step preserves multi-surface fan-out
or single-surface output in `.jarvis-intent-stage/`.

## Decisions

- Build the production `intent` preset from committed file seeds and execute its returned write step
  through `executeWrite` — rules out direct prompt-renderer tests and hand-authored staged trees.
- Use a deterministic invocation binding that derives its output from the rendered split prompt:
  legacy contract yields bundled output, while the revised contract alone yields fan-out output and
  the required unsplit rationale — rules out unconditional expected files that stay green against
  the pre-change prompt.
- Use a multi-surface seed describing one persistence → daemon → CLI behavior and a single-surface
  seed with related concerns inside one boundary — rules out ambiguous fixture classification.
- Establish exactly one primary implementation surface per staged intent, with distinct persistence,
  daemon, and CLI owners; ignore incidental mentions in prerequisites — rules out file-count or
  substring-only coverage that accepts a bundled intent.
- Run multi-surface and single-surface seeds through one shared harness — rules out divergent setup
  that bypasses the split step for either case.
- Require successful writes and ready-intent-valid staged content; durable Git-backed landing remains
  out of scope because the harness starts no subprocess.

## Tasks

- Add committed Markdown seeds for one behavior necessarily spanning persistence, daemon, and CLI,
  and for multiple related concerns within one implementation boundary.
- Add an agent-runnable intent-split regression harness using `buildIntentWorkflowSteps`,
  `executeWrite`, the shared write fixtures, and a stub invocation binding.
- Assert ready-intent-valid post-write `.jarvis-intent-stage/` output, primary-surface ownership, and
  negative controls for both seeds.

## Acceptance criteria

- [ ] `v2/src/execution/intent-split-regression.test.ts` test `multi-surface seed fans out by surface
      through the production split write` drives a committed persistence → daemon → CLI behavior
      through the built split write step, completes the write, and finds ready-intent-valid staged
      intents with exactly one primary implementation surface each and distinct persistence, daemon,
      and CLI owners; it fails against the pre-change prompt.
- [ ] `v2/src/execution/intent-split-regression.test.ts` test `single-surface seed stays whole through
      the production split write` drives a committed seed with multiple related concerns in one
      boundary through the same harness, completes the write, and finds exactly one ready-intent-
      valid staged intent with a one-line body rationale explaining why splitting does not apply;
      it fails against the pre-change prompt.
- [ ] The stub binding derives its staged output from the rendered split prompt: the pre-change
      contract produces rejected bundled multi-surface output and rejected single-surface output
      lacking the one-line rationale, while the revised contract alone satisfies both staging
      assertions.
- [ ] Inverting the multi-surface fan-out contract to the pre-change one-intent path turns
      `multi-surface seed fans out by surface through the production split write` RED through the
      same primary-surface staging oracle.
- [ ] The regression uses only injected bindings and filesystem fixtures; it starts no live model,
      daemon, or OS subprocess.

## Documentation updates

- None — `v2/docs/workflow-runner.md` already owns the operator contract.
