# 02 - Author no-commit plan specs in Jarvis-owned storage

## Problem

`modes.plan.commit: false` is documented (and intended) to keep generated specs out of the target repository entirely, storing them under `~/.jarvis/specs/<project-id>/<spec-dir>/` per `docs/spec-guidance.md` ("External specs (no-commit)") and the `computeNoCommitSpecRoot` helper in `src/modes/plan/spec-paths.ts`. The current implementation in `src/commands/plan.ts` violates that promise:

- For `commit === false`, `worktreePath` is set to `project.root` (src/commands/plan.ts:1070-1071). The agent then writes the spec under `<project.root>/spec/<tempPlanName>/` throughout the refine and draft phases.
- A `renameSync` moves the directory from `<project.root>/spec/<specDirBasename>/` to `~/.jarvis/specs/<projectId>/<specDirBasename>/` only after the draft phase completes successfully (src/commands/plan.ts:1342-1362).
- Any failure, manual kill, validation error, or boundary violation between the agent's first write and that `renameSync` leaves spec files inside the target repository's working tree. The user must hand-clean `spec/tmp-*` or `spec/<plan-name>/` from the target repo.
- Even on the happy path, the agent's first refine writes (and the entire draft phase write boundary check) operate against `worktreePath = project.root`, meaning the boundary helper `assertTargetRepoPlanBoundary` (src/modes/plan/boundary.ts:68-106) is doing double-duty: it both forbids the agent from writing outside `spec/` while *also* tolerating the spec itself being inside the target repo. That is the wrong shape — the spec should not be inside the target repo for any duration.
- Review phases run with the post-rename `finalSpecPath` but in some branches still re-use the original `worktreePath` for status/boundary checks. The review write boundary for no-commit runs must point at the external `finalSpecPath` parent, not at `project.root/spec/...`.
- Plan resume (`jarvis plan --resume <spec-path>`) of an existing no-commit spec must also resume against the external location and never touch the target repo's `spec/` tree.

The desired behavior: for no-commit plan runs, the agent's working directory is `project.root` (so it can read repo guidance), but the spec scaffolding is created directly under a Jarvis-owned external directory and remains there for every phase. Refine, draft, and review all read and write through that external spec path. There is never a `renameSync` from inside the target repo; the spec is born in its final home.

## Scope and decisions

- Behavior change applies only when the effective `commit` flag (from `resolvePlanFlags`) is `false`. The `commit: true` path is unchanged.
- For no-commit runs:
  - The agent is invoked with the working directory still set to `project.root` so it can inspect the target repository's guidance files. The harness must not change the agent cwd.
  - The harness creates the spec directory under `~/.jarvis/specs/<projectId>/` *before* the first agent invocation, using a `tmp-<id>` basename until the plan name is validated, exactly as today — but located outside the target repo from the start.
  - All `seedIntentFile`, refine, draft, and review operations that today operate on `join(worktreePath, "spec", ...)` must operate on `<externalSpecRoot>/<spec-dir-basename>/` for no-commit runs.
  - The `tmp-<id>` → `<validated-name>` rename runs in place inside `~/.jarvis/specs/<projectId>/`. The collision check that today fires before the post-draft cross-repo `renameSync` (src/commands/plan.ts:1300-1313) now fires at directory creation time, before any agent writes.
  - The post-draft `renameSync` that moves the spec out of the target repo is removed.
  - The `injectRepoLineIntoIndex` call for no-commit specs continues to run, but against the external path.
- For boundary enforcement on no-commit runs:
  - The target-repo boundary helper `assertTargetRepoPlanBoundary` retains its current role: ensure the target repo's working tree was not modified at all by the agent (no `spec/` writes, no other writes). It runs against `project.root`. Behavior unchanged when the project root is not a git repo.
  - A new check (or an extension of the existing helper) verifies that the agent wrote *only* under `<externalSpecRoot>/<spec-dir-basename>/`. Since the external location is outside any git repo, this is a filesystem invariant rather than a git-status check: list the external spec directory after the agent runs and confirm no files outside the expected basename appeared. Out-of-bounds writes to siblings under `~/.jarvis/specs/<projectId>/` get reported and (where safe) cleaned up before re-raising.
- Resume:
  - `jarvis plan --resume <spec-path>` with a path under `~/.jarvis/specs/<projectId>/...` resolves the project from the spec's `repo:` line (existing behavior) and continues all writes at that external path.
  - Resume against a no-commit spec must never create a `.worktree/plan-<name>/` or write into the target repo's `spec/` directory.
- Cleanup of the temporary `tmp-<id>/` directory on failure:
  - The existing `cleanupNoCommitTempSpec` function (src/commands/plan.ts:1118-1122) currently removes from `<worktreePath>/spec/<tempPlanName>`. Update it to remove from `<externalSpecRoot>/<tempPlanName>`.
  - Cleanup must run on every error path between directory creation and successful rename to the validated name, the same set of paths it covers today.
- Telemetry and logging:
  - The `plan: spec name=...` log line and the final summary path printed at the end of the run (src/commands/plan.ts:2129-2135) must always show the external path for no-commit runs. Today the summary already prints the external path; keep that, and make sure no intermediate log line prints a target-repo path.
- Target-repo cleanup of pre-existing pollution from earlier broken runs:
  - Out of scope. This spec fixes the source of the pollution; it does not remove leftover `spec/tmp-*` or `<repo-root>/tmp-*` directories from earlier runs. Document the recommended manual cleanup in the docs update below.
- Backward compatibility:
  - There are no on-disk migrations. A no-commit run started under the new code lands its spec entirely under `~/.jarvis/specs/...`.
  - A no-commit run that was interrupted under the old code left files inside the target repo. Resume against those left-behind files is not supported by this spec; users should either move the directory under `~/.jarvis/specs/<projectId>/` manually or rerun `jarvis plan` from scratch.

## Task Checklist

- [ ] Introduce a helper that computes the external spec root for a no-commit run (`<CONFIG_DIR>/specs/<projectSafeId>/<basename>`) and creates the parent `<CONFIG_DIR>/specs/<projectSafeId>/` directory.
- [ ] Refactor the no-commit branch of `planCommand` to set the spec root to that external path before seeding `intent.md` and any other spec files. Stop using `<worktreePath>/spec/<basename>` for any no-commit writes.
- [ ] Remove the post-draft cross-repo `renameSync` (src/commands/plan.ts:1342-1362) and move the tmp→validated-name rename to operate in place inside `<CONFIG_DIR>/specs/<projectSafeId>/`.
- [ ] Move the existing pre-existing-directory collision check (src/commands/plan.ts:1298-1313) so it fires *before* the agent's first write — at directory creation time, against the external path.
- [ ] Update refine, draft, and review phase glue so every read/write that previously used `join(worktreePath, "spec", basename)` uses the external spec root for no-commit runs.
- [ ] Update `cleanupNoCommitTempSpec` to remove the tmp directory from the external path on every failure path it currently covers.
- [ ] For no-commit runs: in addition to the existing `assertTargetRepoPlanBoundary(project.root)` check, add a filesystem-based check that the agent did not create any files outside `<externalSpecRoot>/<spec-dir-basename>/` under `<CONFIG_DIR>/specs/<projectSafeId>/`. When violations are found, report them, treat the run as blocked, and avoid promoting the tmp name to a validated name.
- [ ] Audit review-phase code paths (src/commands/plan.ts:1936, 2026 and surrounding boundary calls) to confirm that no-commit runs pass the external spec root, not `worktreePath`, to any helper that resolves the spec directory.
- [ ] Confirm `jarvis plan --resume <external-spec-path>` continues all writes under the external path and never creates a target-repo worktree or `spec/` write.
- [ ] Add tests covering: (a) successful no-commit run creates the spec only under `~/.jarvis/specs/<projectId>/...` and never writes under `project.root/spec/...`; (b) a refine-phase failure leaves no files inside `project.root`; (c) a draft-phase failure leaves no files inside `project.root`; (d) a review-phase failure leaves no files inside `project.root`; (e) collision against an existing external spec directory is detected before any agent invocation; (f) `jarvis plan --resume` against an external spec path does not create `.worktree/` or touch `project.root/spec/`. Stub agent invocations where appropriate to deterministically trigger each failure mode.
- [ ] Manual end-to-end verification: with `modes.plan.commit: false` globally, run `jarvis plan "something"` against a target repo, kill the run partway through, and confirm `git status` in the target repo is clean and the partial spec lives only under `~/.jarvis/specs/<projectId>/`.

## Acceptance criteria

- [ ] A successful no-commit `jarvis plan` run authors all spec files (`intent.md`, `index.md`, subspecs) directly under `~/.jarvis/specs/<projectId>/<spec-dir-basename>/` and never writes anything under `<project.root>/spec/` at any phase.
- [ ] A no-commit `jarvis plan` run that fails or is killed during the refine phase leaves no files in `<project.root>/spec/` and leaves no top-level `tmp-*` directory inside `<project.root>`.
- [ ] A no-commit `jarvis plan` run that fails during the draft phase leaves no files in `<project.root>/spec/` and any partial files live only under `~/.jarvis/specs/<projectId>/`.
- [ ] A no-commit `jarvis plan` run that fails during a review phase leaves no files in `<project.root>/spec/` and any partial files live only under `~/.jarvis/specs/<projectId>/`.
- [ ] The collision guard for a pre-existing `~/.jarvis/specs/<projectId>/<spec-dir-basename>/` runs *before* the first agent invocation; the agent is not invoked when a collision is detected, and the target repo is not touched.
- [ ] After every no-commit run (success or failure), `git status` against `<project.root>` (when it is a git repo) reports no working-tree changes attributable to the plan run, and `assertTargetRepoPlanBoundary` returns `{ ok: true }` at every existing call site.
- [ ] `jarvis plan --resume <path under ~/.jarvis/specs/...>` performs every read and write under that external path. No `.worktree/plan-<name>/` is created, and `<project.root>/spec/` is not modified.
- [ ] `injectRepoLineIntoIndex` is applied to the external `index.md` for no-commit runs.
- [ ] The post-run summary line shows the external `~/.jarvis/specs/<projectId>/<spec-dir-basename>/index.md` path and the `jarvis run` command suggestion uses that path.
- [ ] `bun run typecheck` passes.
- [ ] `bun test` passes.

## Documentation updates

- Update `docs/plan-mode.md` (the no-commit / external-spec section) to state that spec scaffolding is created under `~/.jarvis/specs/<projectId>/` before the first agent invocation and stays there for every phase. Remove or rewrite any wording that implies the spec is staged inside the target repo and moved later.
- Update `docs/spec-guidance.md` under "External specs (no-commit)" if it currently implies any staging inside the target repo (verify against current text and adjust if needed).
- In `README.md`, ensure the `commit: false` description in the Configuration section is consistent with the new flow (the existing line "Plan output then goes to `~/.jarvis/specs/...`" is correct; just confirm nothing nearby contradicts it).
- Add a short note (in `docs/plan-mode.md` or a troubleshooting section) describing the manual cleanup for users whose target repos still contain leftover `spec/tmp-*` or `<repo-root>/tmp-*` directories from prior broken no-commit runs: delete the directories; this spec does not auto-clean them.
