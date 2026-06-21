# 01 — Resolve and run the update-snapshots command, then re-test

## Problem

Subspec `00` rejects a snapshot-churn blocker only when an injected seam reports the
re-test green; with no seam it fail-safes to exit 7. This subspec provides the
production seam: resolve a target-repo update-snapshots command (configured or
detected, never hardcoded), run it in the agent worktree, re-run the test command,
and return green/red.

## Decisions

- Command resolution order: an explicit per-project `updateSnapshotsCommand` config field wins; absent that, detect a conventional update-snapshots script in the target repo's `package.json` `scripts`. Rules out: hardcoding a framework command (`vitest --update` / `jest -u`) — the intent requires it be target-repo-agnostic.
- Detection reads the target repo's **root** `package.json` `scripts` and matches a small candidate list of conventional names (`test:update`, `test:u`, `update-snapshots`, `updateSnapshots`). Precedence is **candidate-list order** (as written above), not `package.json` key order: the first candidate name present in `scripts` wins. Resolution returns `bun run <script>`. Deferred to first consumer: the exact candidate set beyond these, and any non-root (monorepo/workspace) `package.json` — pin when a target repo needs it. Rules out: parsing test-framework config to synthesize flags (brittle, framework-coupled); ambiguous "first match" that could mean file order.
- Command-string execution: a resolved command — whether a configured `updateSnapshotsCommand` (arbitrary string) or a detected `bun run <script>` — is tokenized on whitespace into head + args and run via `execFile(head, args, …)` (no shell). The existing `bun run test` runners use clean argv with no string parsing; this keeps that property. Deferred to first consumer: quoted/embedded-space arguments — pin when a target repo needs them. Rules out: passing the raw string to a shell (injection / quoting surprises); leaving tokenization undefined.
- Unresolvable command (no config field, no matching script, no/unreadable `package.json`) ⇒ seam returns **false** (fail-safe: blocker stands), and emits a diagnostic breadcrumb (see diagnostics decision). Rules out: synthesizing a default update command that could mangle an unconfigured repo.
- Diagnostics: every non-green / fail-safe outcome logs a distinct breadcrumb to stderr so the operator can tell **why** the blocker stood — at minimum distinguishing "could not resolve an update-snapshots command" (unresolvable) from "ran update, suite still red" and "update command errored". The seam itself stays a bare boolean for `00`; the diagnostic lives here in `01` where resolution and execution happen. Rules out: collapsing all non-green paths to a silent `false` (the blocker-stood-only-because-unconfigured case is invisible — defeats the intent).
- The update command runs in the **agent working dir**, not a throwaway worktree, so corrected snapshots persist as part of the work (the `00` contract). Kill-before-commit window: if the run ends before the next commit, the uncommitted snapshot updates are lost — identical to the existing base-ref strip path; accepted, not mitigated here. Rules out: a detached base-ref-style worktree (snapshots would be discarded).
- Re-test command = the target repo's `bun run test`, matching the base-ref runner (`v1/src/modes/patch/base-ref-test-runner.ts`) and shrink (`v1/src/modes/patch/shrink.ts:252`). Rules out: a bespoke command diverging from what the rest of patch mode runs.
- Update command non-zero exit / throw ⇒ seam returns **false** (fail-safe) with a diagnostic. The agent worktree is left as-is (whatever the partial update wrote); no revert. Rules out: rejecting a real blocker because the update tool itself errored; a cleanup step that could discard legitimate edits.
- Green = re-test exits 0; any non-zero ⇒ false (with a diagnostic). Rules out: treating an update that left the suite red as cleared churn.
- Default-seam wiring: the production `runSnapshotUpdateRetest` is constructed from `preflight.cfg` (project config, source of `updateSnapshotsCommand`) and `preflight.agentWorkingDir`, mirroring the `runBaseRefTests` default wiring; both are confirmed in scope at the wire point. Rules out: threading new state to the wire point.
- Config: add optional `updateSnapshotsCommand?: string` to the project schema, parsed/validated like other optional project fields and surfaced in `jarvis config`. Rules out: a global (non-per-project) setting — the command is target-repo-specific.

## Task checklist

- [x] Add `updateSnapshotsCommand?: string` to the `Project` type and config parse/validation in `v1/src/config.ts`.
- [x] Implement the resolver: config field first, else detect a conventional root-`package.json` update-snapshots script in candidate-list order; return the command or `undefined`.
- [x] Implement the runner: resolve → if unresolvable log + return false → whitespace-tokenize the command to head+args and `execFile` it in the agent worktree → run `bun run test` → return exit-0; any non-zero/throw → log + false. Log a distinct breadcrumb on each non-green path (unresolvable vs update-errored vs still-red).
- [x] Wire it as the default `runSnapshotUpdateRetest` seam in `run.ts` (from `preflight.cfg` + `preflight.agentWorkingDir`) when none is injected, mirroring the `runBaseRefTests` default wiring.
- [x] Add tests: configured command path, detected-script path, unresolvable → false, update success + green re-test → true, update success + red re-test → false, update command failure → false. Each non-green case asserts its distinct diagnostic.
- [x] Add an end-to-end (no-injected-seam) test: a temp git repo fixture with a stale snapshot and an update script that clears it, exercising the default seam so a claim blocker is rejected without injection.

## Acceptance criteria

- [x] A temp git-repo fixture (stale snapshot + an update script that clears it, `updateSnapshotsCommand` configured) exercises the default seam with **no injected seam**: the claim blocker is rejected end-to-end — the run continues past exit 7 and the `## Blocker` section is removed.
- [x] With no `updateSnapshotsCommand` configured, the runner detects a conventional update-snapshots script from the target repo's root `package.json` (candidate-list order) and uses it; with neither configured nor detected, the seam returns non-green, logs an "unresolvable" diagnostic, and the blocker stands (exit 7).
- [x] The update command runs in the agent working dir and the corrected snapshot files remain in that worktree afterward (not discarded); no other working-dir paths are reverted or cleaned.
- [x] When the update command fails (non-zero/throws) or the re-test stays red, the seam reports non-green and the blocker stands (exit 7).
- [x] Each non-green outcome (unresolvable command, update-command error, still-red re-test) emits a distinct stderr diagnostic so the operator can tell why the blocker stood.
- [x] `jarvis config` round-trips a project `updateSnapshotsCommand` value (set, persisted, re-read) and an absent value remains absent.
- [x] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- [x] `v2/docs/v1-behaviors.md` — record that the snapshot-churn gate's default seam resolves the update-snapshots command (per-project `updateSnapshotsCommand` config first, else a detected conventional root-`package.json` script in candidate-list order, else non-green fail-safe), tokenizes the command on whitespace and runs it (no shell) in the agent worktree (corrected snapshots persist), re-runs the target `bun run test`, treats any non-zero exit as non-green, and emits a distinct stderr diagnostic on each non-green path (unresolvable / update-errored / still-red).
- [x] Config field reference — document the per-project `updateSnapshotsCommand` field (resolution precedence over detection; used only by the snapshot-churn blocker gate).
