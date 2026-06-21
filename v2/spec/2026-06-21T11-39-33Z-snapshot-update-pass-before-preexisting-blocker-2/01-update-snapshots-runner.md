# 01 — Resolve and run the update-snapshots command, then re-test

## Problem

Subspec `00` rejects a snapshot-churn blocker only when an injected seam reports the
re-test green; with no seam it fail-safes to exit 7. This subspec provides the
production seam: resolve a target-repo update-snapshots command (configured or
detected, never hardcoded), run it in the agent worktree, re-run the test command,
and return green/red.

## Decisions

- Command resolution order: an explicit per-project `updateSnapshotsCommand` config field wins; absent that, detect a conventional update-snapshots script in the target repo's `package.json` `scripts`. Rules out: hardcoding a framework command (`vitest --update` / `jest -u`) — the intent requires it be target-repo-agnostic.
- Detection matches a small set of conventional script names in `package.json` `scripts` (e.g. `test:update`, `test:u`, `update-snapshots`, `updateSnapshots`). First match wins; resolution returns `bun run <script>`. Deferred to first consumer: the exact conventional-name set beyond these — pin when a target repo needs another. Rules out: parsing test-framework config to synthesize flags (brittle, framework-coupled).
- Unresolvable command (no config field, no matching script, no/unreadable `package.json`) ⇒ seam returns **false** (fail-safe: blocker stands). Rules out: synthesizing a default update command that could mangle an unconfigured repo.
- The update command runs in the **agent working dir**, not a throwaway worktree, so corrected snapshots persist as part of the work (the `00` contract). Rules out: a detached base-ref-style worktree (snapshots would be discarded).
- Re-test command = the target repo's `bun run test`, matching the base-ref runner (`v1/src/modes/patch/base-ref-test-runner.ts`) and shrink (`v1/src/modes/patch/shrink.ts:252`). Rules out: a bespoke command diverging from what the rest of patch mode runs.
- Update command non-zero exit / throw ⇒ seam returns **false** (fail-safe). The agent worktree is left as-is (whatever the partial update wrote); no revert. Rules out: rejecting a real blocker because the update tool itself errored; a cleanup step that could discard legitimate edits.
- Green = re-test exits 0; any non-zero ⇒ false. Rules out: treating an update that left the suite red as cleared churn.
- Config: add optional `updateSnapshotsCommand?: string` to the project schema, parsed/validated like other optional project fields and surfaced in `jarvis config`. Rules out: a global (non-per-project) setting — the command is target-repo-specific.

## Task checklist

- [ ] Add `updateSnapshotsCommand?: string` to the `Project` type and config parse/validation in `v1/src/config.ts`.
- [ ] Implement the resolver: config field first, else detect a conventional `package.json` update-snapshots script; return the command or `undefined`.
- [ ] Implement the runner: resolve → if unresolvable return false → run the update command in the agent worktree → run `bun run test` → return exit-0; any non-zero/throw → false.
- [ ] Wire it as the default `runSnapshotUpdateRetest` seam in `run.ts` when none is injected (mirroring the `runBaseRefTests` default wiring).
- [ ] Add tests: configured command path, detected-script path, unresolvable → false, update success + green re-test → true, update success + red re-test → false, update command failure → false.

## Acceptance criteria

- [ ] In a target repo with a configured `updateSnapshotsCommand` whose run makes the suite pass, a claim blocker citing pre-existing failures is rejected end-to-end without any injected seam: the run continues past exit 7 and the `## Blocker` section is removed.
- [ ] With no `updateSnapshotsCommand` configured, the runner detects a conventional update-snapshots script from the target repo's `package.json` and uses it; with neither configured nor detected, the seam returns non-green and the blocker stands (exit 7).
- [ ] The update command runs in the agent working dir and the corrected snapshot files remain in that worktree afterward (not discarded); no other working-dir paths are reverted or cleaned.
- [ ] When the update command fails (non-zero/throws) or the re-test stays red, the seam reports non-green and the blocker stands (exit 7).
- [ ] `jarvis config` round-trips a project `updateSnapshotsCommand` value (set, persisted, re-read) and an absent value remains absent.
- [ ] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- [ ] `v2/docs/v1-behaviors.md` — record that the snapshot-churn gate's default seam resolves the update-snapshots command (per-project `updateSnapshotsCommand` config first, else a detected conventional `package.json` script, else non-green fail-safe), runs it in the agent worktree (corrected snapshots persist), re-runs the target `bun run test`, and treats any non-zero exit as non-green.
- [ ] Config field reference — document the per-project `updateSnapshotsCommand` field (resolution precedence over detection; used only by the snapshot-churn blocker gate).
