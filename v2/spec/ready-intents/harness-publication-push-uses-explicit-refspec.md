---
name: harness-publication-push-uses-explicit-refspec
---

# Completion publication pushes an explicit branch refspec

## Prerequisites

## Problem

- Completion publication chooses between bare `git push` and `git push -u` from upstream presence, so a target branch tracking a differently named upstream fails under `push.default=simple` before PR creation.
- Initial publication and resume/retry share this failure through the completion publisher.

Unsplit rationale: Push command selection, publication retry, and resume replay use one completion-publisher execution-loop boundary; tests and durable documentation describe that same behavior.

## Primary implementation surface

- execution-loop

## Behavior

- Every completion publication attempt pushes `HEAD` to the run's target branch with `git push origin HEAD:<branch>`.
- Initial publication, transient push retry, and resume publication use the same explicit refspec and do not depend on upstream tracking or `push.default`.
- Matching-upstream and no-upstream branches retain successful push, PR creation/reuse, body refresh, and publication evidence behavior.

## Decisions

- Use the run's target branch as the explicit destination on every completion push; rules out bare push, upstream-derived destinations, and harness-owned Git config mutation.
- Harden only completion publication; rules out normalizing or rejecting remote-tracking `--base` inputs at admission.
- Keep command semantics canonical in `v2/docs/write-behavior.md`; rules out duplicating the same contract across workflow and daemon docs.

## Acceptance criteria

- [ ] `v2/src/execution/completion-publisher.test.ts` captures `git push origin HEAD:<branch>` for a branch whose upstream is a differently named ref and fails against the pre-fix upstream-sensitive command selection.
- [ ] `v2/src/execution/completion-publisher.test.ts` and `v2/src/execution/workflow-runner-resume.test.ts` prove initial publication, transient retry, and resume replay all use the explicit refspec without reading upstream state.
- [ ] Matching-upstream and no-upstream cases in `v2/src/execution/completion-publisher.test.ts` retain successful publication after their expected push argv is aligned with the explicit refspec.
- [ ] `v2/src/execution/completion-publisher.test.ts` — `pushes HEAD to the target branch independently of upstream tracking` contains `// @mutate v2/src/execution/completion-publisher.ts "const pushArgs = [\"push\", \"origin\", \`HEAD:${input.branch}\`];" -> "const pushArgs = await checkHasUpstream(git, input.worktreePath, input.branch) ? [\"push\"] : [\"push\", \"-u\", \"origin\", input.branch];"`; Keystone checkpoint:
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — completion publication uses `git push origin HEAD:<branch>` independently of upstream tracking and `push.default`; initial, retry, and resume paths share the command.
- `v2/docs/v1-behaviors.md` — record the v2 completion-publication divergence from v1's upstream-sensitive two-phase push behavior.
