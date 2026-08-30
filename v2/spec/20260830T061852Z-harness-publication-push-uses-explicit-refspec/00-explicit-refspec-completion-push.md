# Use explicit HEAD refspec on completion publication push

## Problem

`createCompletionPublisher` (`v2/src/execution/completion-publisher.ts`) chooses bare `git push` when `branch@{u}` resolves and `git push -u origin <branch>` otherwise. A run branch whose upstream tracks a differently named remote ref fails under `push.default=simple` before PR creation. Initial publication, transient push retry (`runPublicationWithRetry`), and workflow resume replay all share this publisher boundary.

## Decision ledger

- Every completion publication push runs `git push origin HEAD:<branch>` with the run's target `branch` as the destination ref; rules out bare `git push`, `git push -u`, upstream-derived destinations, and harness-owned Git config mutation.
- Drop upstream detection from the push path; remove `checkHasUpstream` when nothing else references it; rules out retaining upstream-sensitive command selection anywhere in completion publication.
- Scope is `completion-publisher.ts` only; rules out normalizing or rejecting remote-tracking `--base` inputs at admission.
- Canonical push semantics live in `v2/docs/write-behavior.md`; rules out duplicating the same contract across workflow and daemon docs.
- Resume and retry inherit the explicit refspec through the shared `createCompletionPublisher` seam; rules out a separate push argv in workflow-runner resume wiring.

## Tasks

- In `v2/src/execution/completion-publisher.ts`, replace the upstream-derived branch inside the `runPublicationWithRetry("push", …)` path with an explicit `["push", "origin", "HEAD:<branch>"]` argv built from the run's target branch (`input.branch`); delete `checkHasUpstream` when unused.
- In `v2/src/execution/completion-publisher.test.ts`, add `pushes HEAD to the target branch independently of upstream tracking`: upstream `@{u}` resolves to a differently named ref, assert every push invocation is `push origin HEAD:<branch>`, and assert no `rev-parse …@{u}` call.
- In `v2/src/execution/completion-publisher.test.ts`, extend transient push retry coverage so each retry attempt records the same explicit refspec argv (update `retries transient push errors up to 3 attempts using the injected delay and retry-notice seams` or add a focused sibling).
- In `v2/src/execution/completion-publisher.test.ts`, align `publishes push with existing upstream`, `publishes push with new upstream and creates draft PR`, and `awaits upstream detection, push, HEAD lookup, PR lookup/create/confirm, and body refresh in order` with the explicit refspec and without upstream detection in the ordering sequence.
- In `v2/src/execution/workflow-runner-resume.test.ts`, add a test that drives completion-publication resume through `createCompletionPublisher` with a recording `git` seam and asserts resume replay pushes `origin HEAD:<branch>` without `@{u}` lookup.
- Update `v2/docs/write-behavior.md` and `v2/docs/v1-behaviors.md` as listed below.

## Acceptance criteria

- [ ] `v2/src/execution/completion-publisher.test.ts` test `pushes HEAD to the target branch independently of upstream tracking` asserts `git push origin HEAD:<branch>` when `branch@{u}` resolves to a differently named ref; reachable on `main` via upstream-sensitive push selection in `v2/src/execution/completion-publisher.ts`; fails against the pre-fix code.
- [ ] `v2/src/execution/completion-publisher.test.ts` test `retries transient push errors up to 3 attempts using the injected delay and retry-notice seams` (or a focused sibling in the same file) asserts each push retry uses `git push origin HEAD:<branch>` and does not call `rev-parse …@{u}`; fails against the pre-fix upstream-sensitive push selection.
- [ ] `v2/src/execution/workflow-runner-resume.test.ts` test `resume publication push uses explicit refspec without upstream detection` drives completion-publication resume through `createCompletionPublisher`, records push argv, and proves `origin HEAD:<branch>` without `@{u}` lookup; fails against the pre-fix upstream-sensitive push selection.
- [ ] `v2/src/execution/completion-publisher.test.ts` — `publishes push with existing upstream` and `publishes push with new upstream and creates draft PR` stay green after their expected push argv is aligned with `git push origin HEAD:<branch>`.
- [ ] `v2/docs/write-behavior.md` — **Push+PR phase** documents completion publication `git push origin HEAD:<branch>` independently of upstream tracking and `push.default`, with initial, retry, and resume paths sharing the command.
- [ ] `v2/docs/v1-behaviors.md` — records v2 completion-publication push divergence from v1's upstream-sensitive two-phase push (`git push -u` then bare `git push`).
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — completion publication uses `git push origin HEAD:<branch>` independently of upstream tracking and `push.default`; initial, retry, and resume paths share the command.
- `v2/docs/v1-behaviors.md` — record the v2 completion-publication divergence from v1's upstream-sensitive two-phase push behavior.
