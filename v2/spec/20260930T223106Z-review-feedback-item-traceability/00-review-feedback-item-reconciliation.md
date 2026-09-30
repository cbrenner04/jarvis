# Reconcile captured PR review items at review-feedback settlement

## Problem

Review-feedback runs require a per-item response sidecar and a capture artifact, but terminal settlement does not compare them, so operators cannot see which captured thread or comment ids were addressed, declined, or left without a response line.

## Decisions

- Captured item ids come from `.jarvis-pr-review-input.json` in the lane worktree at settlement: each thread's `threadId` and each top-level comment's `commentId` — rules out re-fetching GitHub at settlement or using prompt-only markers absent from the artifact.
- Response lines match `- <id>: addressed` or `- <id>: declined:` (same id grammar as `prompts/review-feedback/write.md`) — rules out inferring addressed items from git diff or stdout tokens alone.
- `addressed` ids are ids with an `: addressed` line; `declined` ids are ids with a `: declined:` line; `unaddressed` ids are captured ids appearing in neither set — rules out treating a missing sidecar line as addressed and rules out folding declined ids into the addressed list.
- Reconcile in a pure exported helper under `v2/src/execution/` (colocated unit test) invoked from write-loop terminal settlement when the active step's `promptId` is `review-feedback.prompt.write` — rules out reconciling only on the publication tail after the sidecar may be unread or only in CLI admission.
- Run reconciliation on every terminal `loop_finished` for `review-feedback.prompt.write` regardless of terminal reason — rules out omitting id arrays on `blocked` / `contract_miss` or reconciling only on `done` / `no-work`.
- Master capture walk order for bucket membership: `threads[]` in artifact order, then top-level `comments[]` in artifact order; each bucket lists ids in that walk restricted to ids in the bucket — rules out lexicographic reorder that breaks capture-stable AC wording.
- Missing or unreadable `.jarvis-pr-review-input.json` at settlement treats the captured id set as empty and persists three empty arrays — rules out settlement hard-fail on reconcile read errors or leaving id fields unset while other terminals carry arrays.
- Persist `reviewFeedbackAddressedItemIds`, `reviewFeedbackDeclinedItemIds`, and `reviewFeedbackUnaddressedItemIds` (string arrays, stable capture order within each bucket) on the terminal `loop_finished` row for that write loop — rules out a separate SQLite column or run-row snapshot before the terminal log exists.
- Empty capture yields three empty arrays on settlement — rules out skipping persistence when the agent left an empty response sidecar for an empty capture.

## Tasks

- Add the reconciliation helper plus parser for the response sidecar and capture artifact shape.
- Call it when appending terminal `loop_finished` for review-feedback write steps; spread the three id arrays onto the event.
- Extend `LogLoopFinishedEvent` / `LoopFinishedEvent` typing in `v2/src/persistence/log-stream.ts`.

## Acceptance criteria

- [ ] `review-feedback-item-reconciliation.test.ts` test `classifies addressed, declined, and unaddressed capture ids from the sidecar` builds a two-thread one-comment capture with a sidecar addressing one id, declining one, and omitting one; asserts the three id arrays; fails against the pre-fix code.
- [ ] `review-feedback-write-run.test.ts` adds `persists addressed and unaddressed item ids on terminal loop_finished when only one captured item is addressed`, driving `executeWorkflow` with two captured ids and a sidecar that addresses one; asserts terminal `loop_finished` carries both non-empty addressed and unaddressed arrays; fails against the pre-fix settlement path.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.
- [ ] `bun run test:integration:v2` passes.

## Documentation updates

- None (operator-facing read paths land in subspec `01`; capture/response contracts stay in existing `write-behavior.md` / `workflow-runner.md`).
