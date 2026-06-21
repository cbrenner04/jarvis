# 01 — Resolve and run the target repo's update-snapshots command

## Problem

Subspec `00` rejects a blocker only when an injected seam reports the agent
working tree green after an update-snapshots pass; with no seam it fall-safes to
base-ref validation. This subspec provides the production seam: resolve the
target repo's update-snapshots command (target-repo-agnostic, never hardcoded),
run it in the agent working tree, re-test, and return green/red — so the gate
works outside tests.

## Decisions

- Resolution order: a per-project **configured** command wins, else **detect** from the target repo, else **unresolved → gate skips** (seam returns false; no rejection). Configured is the operator escape hatch for repos the detector can't classify; detection is the default so common repos need no config. Rules out: hardcoding one command (the intent forbids it); rejecting on an unknown runner (would weaken a real blocker on a repo whose update command we can't determine).
- Configured override lives on the project registry entry (`Project.snapshots?.updateCommand?: string` in `v1/src/config.ts`), validated like the existing `plan` sub-object (strict unknown-key rejection). Rules out: an env-var-only override (not discoverable via `jarvis config`, inconsistent with how every other per-project setting is stored); a global (non-per-project) setting (different target repos use different runners).
- Detection reads the target `package.json` `test` script and devDependencies and maps the known runner to its update flag: bun test → `bun test --update-snapshots`; vitest → `vitest run -u`; jest → `jest -u`. An unrecognized runner is **unresolved** (skip the gate). Rules out: forwarding `-u` through `bun run test -- -u` blindly (not all scripts forward args; produces false greens or errors); guessing a flag for an unknown runner.
- The update pass runs **in place in the agent working directory**, mutating snapshot files there — the whole point is to complete the agent's unfinished snapshot update so the run can progress. Rules out: a throwaway worktree (would discard the updates and leave the agent no further along).
- Re-test after the update uses the harness's standard `bun run test` (matching `shrink.ts:252` and the base-ref runner), run separately from the update pass. The separate re-test is the discriminator: an update-mode run writes snapshots and typically exits 0 regardless, so it cannot itself prove the failures were stale — only a clean re-test that now passes does. Rules out: treating the update command's own exit code as the green signal (always-green update modes make every blocker churn).
- Updated snapshot files are left **uncommitted** in the working tree; the normal WIP-commit flow on subsequent iterations absorbs them. Rules out: a dedicated snapshot commit (extra commit churn; the loop already commits WIP).
- Green = the post-update `bun run test` exits 0. Any non-zero, an unresolved command, or an update-pass error is treated as non-green (seam returns false), so `00` falls through to base-ref validation. Rules out: rejecting a real blocker because the resolver or update pass itself errored.

## Task checklist

- [ ] Add the optional `snapshots.updateCommand` field to the `Project` type and config validation/serialization, with strict unknown-key rejection mirroring `plan`.
- [ ] Implement the update-snapshots command resolver: configured override → detect from `package.json` test script + devDependencies (bun/vitest/jest) → unresolved.
- [ ] Implement the production runner: resolve the command; if unresolved return false; else run it in the agent working dir, then run `bun run test`; return pass/fail. Treat any error as false.
- [ ] Wire it as the default `opts.updateSnapshotsAndRetest` in `run.ts` when no seam is injected (bound to the agent working dir + resolved project config), mirroring the `runBaseRefTests` default wiring.
- [ ] Add tests: configured override beats detection; detection maps bun/vitest/jest; unknown runner → unresolved (false, gate skipped); end-to-end stale-snapshot repo green after update → blocker rejected; real-failure repo still red → blocker proceeds to base-ref path.

## Acceptance criteria

- [ ] In a git checkout whose only test failures are stale snapshots, a patch-mode blocker citing pre-existing failures is rejected without any injected seam: the update-snapshots command runs, the re-test passes, the run continues past exit 7, and the `## Blocker` section is removed.
- [ ] A per-project configured update-snapshots command takes precedence over detection; with no configured command, a bun/vitest/jest target repo is detected from its `package.json`; an unrecognized runner leaves the command unresolved and the gate does not reject (control falls through to base-ref validation).
- [ ] The update pass runs in the agent working directory (snapshot files updated in place, left uncommitted); the post-update re-test uses `bun run test`, and a still-failing re-test (real failures remain) returns non-green so the blocker proceeds.
- [ ] An unresolved command, a non-zero re-test, or an error in the update/resolve path returns non-green (fail-safe), never a rejection.
- [ ] `jarvis config` round-trips a `snapshots.updateCommand` value and rejects unknown keys under `snapshots`.
- [ ] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- [ ] `v2/docs/v1-behaviors.md` — record that the snapshot-churn gate's production seam resolves the update-snapshots command (per-project configured override → detected from the target `package.json` test script/devDependencies for bun/vitest/jest → unresolved skips the gate), runs it in place in the agent working directory, re-tests with `bun run test`, leaves updated snapshots uncommitted, and treats any non-zero/unresolved/errored outcome as non-green.
- [ ] `v1/docs/config.md` — document the per-project `snapshots.updateCommand` setting (purpose, precedence over detection).
