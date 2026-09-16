---
name: git-fixture-template-repo
---

# Git fixture template repo

Per-test git fixtures (e.g. `intent-output.test.ts`) run ~5 git execs per test. A shared test-support helper creates a template repo once per file and copies it per test.

## Decisions

- Converted fixtures keep their initial commit content.

## Acceptance criteria

- [ ] `intent-output`, `write-loop-intent-landing`, and `workflow-runner-intent` fixtures use the template-repo helper.
- [ ] Test count per slice is unchanged or higher versus the merge base.
- [ ] `bun run typecheck`, `bun run test`, and `bun run check` pass.

## Documentation updates

- `v2/docs/test-writing.md` — template-repo helper; note before/after per-test file times.

## Prerequisites

- Intent-landing and staged-lint paths accept an injectable markdown lint dependency that unit tests stub (these fixtures share files with `intent-output.test.ts`, which inherits the real-lint-spawn slowness fixed by that sibling intent)
