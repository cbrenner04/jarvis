# Surface checkpointed partial progress in the next prompt

## Problem

An iteration-timeout can checkpoint partial edits, but the next implementation prompt looks like a fresh attempt. The next agent may redo the same work instead of continuing the checkpoint.

## Decisions

- Persist a versioned receipt at `git rev-parse --git-path jarvis/iteration-timeout-checkpoint.json`; rules out process memory, the worktree, or append-only telemetry as resume evidence.
- Receipt v1 contains only `version: 1`, `reason: "iteration-timeout"`, `checkpointOid`, and the normalized repo-relative `activeSubspecPath`; rules out inferring identity from the generic commit subject.
- Write the receipt only after `WIP: checkpoint (iteration-timeout)` commits successfully, and add `Spec: <activeSubspecPath>` to that commit body; rules out receipts for no-op or failed checkpoints and commits with no subspec identity.
- Accept a receipt only when every field has the exact v1 type/value, `checkpointOid` is a full Git object ID, `HEAD` equals that OID, the commit subject and `Spec:` line match, and Jarvis selected the same still-active subspec; rules out malformed, partial, stale, or cross-subspec evidence.
- Any intervening commit invalidates the receipt because `HEAD` no longer equals `checkpointOid`; rules out carrying continuation context across unrelated progress.
- Consume an accepted receipt atomically before the next normal agent invocation; rules out repeating the notice across invocations after a non-timeout/no-commit attempt.
- Treat a receipt as immediate-predecessor evidence only while unconsumed; every normal invocation consumes it before spawn regardless of that attempt's outcome or commit activity, which rules out a stale `HEAD` checkpoint repeating later.
- If receipt consumption fails, omit the continuation context and warn; rules out showing a notice that can repeat indefinitely.
- Git inspection, receipt read/parse/validation, and receipt-write failures fail closed and warn without changing the run's existing exit semantics; rules out accidental enablement or a new fatal preflight.
- Add an optional timeout-checkpoint context only to normal `buildPrompt` output; rules out changing fix-up, shrink, review, or every implementation prompt.
- Tell the next agent to inspect and continue the existing partial implementation; rules out merely naming the checkpoint without changing agent direction.
- Keep prompt output byte-for-byte unchanged when context is absent; rules out an empty heading or generic resume prose on fresh/non-timeout attempts.
- Own the optional section wording and placeholder in `patch.prompt.body`; rules out runtime-only prompt prose outside the registry contract.
- Bump `patch.prompt.body`'s revision for the contract change; rules out mutating a published prompt revision in place.
- Regenerate the revision-keyed shared and Codex-wrapper fixtures for their canonical absent-context render; rules out stale governed artifacts.
- Cover the present render with a focused registry-backed prompt test rather than a second fixture family; rules out unsupported duplicate snapshots while still testing both optional states from the revisioned template.

## Tasks

- Persist, validate, and one-shot consume the timeout-checkpoint receipt for the still-active subspec.
- Extend `buildPrompt` and `patch.prompt.body` with an optional delimited context section that is removed when absent.
- Add prompt and run-loop coverage for valid, stale, malformed, mismatched, failed-inspection, and consumed receipts.
- Bump the prompt revision and regenerate the canonical shared and Codex-wrapper fixtures.
- Update `v1/docs/run-loop.md` and `v2/docs/v1-behaviors.md` with the prompt-conditioning behavior.
- Run `bun run typecheck` and `bun run test`.

## Acceptance criteria

- [ ] After an active subspec iteration times out and commits partial edits, the next normal implementation prompt tells the agent that partial implementation is present and to inspect and continue it.
- [ ] A successful timeout checkpoint records the exact receipt fields and matching commit identity needed to qualify the same active subspec across a new Jarvis process.
- [ ] The continuation notice is emitted once: after timeout → notice → non-timeout/no-commit attempt, the following invocation has the pre-change prompt.
- [ ] Idle timeout, run timeout, non-timeout failure, a no-op/failed checkpoint, an intervening commit, a different active subspec, and absent or invalid receipt metadata retain the pre-change implementation prompt.
- [ ] Git or receipt inspection/consumption failure warns, omits continuation context, and preserves existing run exit semantics.
- [ ] Fix-up, shrink, and review prompts remain unchanged.
- [ ] The bumped `patch.prompt.body` registry revision governs both optional renders: focused tests prove absent output is byte-for-byte stable and present output directs continuation; canonical shared and Codex-wrapper fixtures match the revision.
- [ ] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- `v1/docs/run-loop.md`: document receipt qualification, one-shot consumption, failure behavior, and the resumed normal prompt.
- `v2/docs/v1-behaviors.md`: record the same v1 behavior and source paths.

## Out of scope

- Creating the timeout checkpoint commit.
- Repeated-timeout detection or signaling.
