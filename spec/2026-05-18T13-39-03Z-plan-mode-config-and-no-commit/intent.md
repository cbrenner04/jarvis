---
name: plan-mode-config-and-no-commit
---

we need to update a couple of things for plan mode. first the date prefix should be config based. while its what i want for jarvis changes, as well as other personal repos, it won't match expectations in other repos. along the same lines, at work, the spec-based dev isn't a reality in most repos. we need a solution for creating, reviewing, and approving specs that won't be committed.

## Interview turn 1

Two independent features, both driven by the need to run `jarvis plan` in repos with different conventions.

### Feature 1 — configurable timestamp prefix on spec directories

Currently `plan.ts:995` unconditionally calls `formatPlanSpecTimestamp()` to produce a `YYYY-MM-DDTHH-mm-ssZ-<name>` directory basename. The user wants this opt-in rather than always-on.

**Config placement**: Add `specTimestamp: boolean` (default `true`) to a new per-project `plan` override block inside the existing `projects` entries in `~/.jarvis/config.json`. A global default under `modes.plan` should also be supported, with the project-level override taking precedence. This mirrors the existing pattern where `git` is a top-level field with per-project overrides.

Concrete shape (proposed):
```json
// global default
"modes": { "plan": { "agentOrder": [...], "specTimestamp": true } }

// per-project override
"projects": {
  "my-work-repo": { "root": "...", "plan": { "specTimestamp": false } }
}
```

When `specTimestamp` resolves to `false` the `specDirBasename` equals `planName` (no prefix), matching the legacy untimestamped form that spec-guidance.md already documents as valid.

**Scope boundary**: `--resume` resolves `planName` from the directory basename via `stripPlanSpecTimestampPrefix` — this already handles both forms, so no additional resume changes are needed.

### Feature 2 — no-commit (local-only) plan workflow

The current plan flow always requires a git repo with an `origin` remote and an accessible `gh` CLI: it creates a worktree, commits after each phase (interview/draft/review), and opens a draft PR. In many work repos the spec tree should exist only as local files; it is never committed.

**Proposed approach**: Add `commit: boolean` (default `true`) to the same config locations as `specTimestamp`. When `commit: false`:

- Skip worktree creation; write the spec tree directly into the main checkout under `spec/<name>/` (or `spec/<timestamp>-<name>/` per the timestamp setting).
- Skip all git commits (interview, draft, review, blocker).
- Skip PR creation and push.
- Still run interview, draft, and review phases — the agent still produces files on disk.
- Print a summary pointing at `spec/<name>/index.md` so the user knows where the output landed.
- `jarvis run spec/<name>/index.md` still works because it reads from disk; the merge-first rule in spec-guidance.md does not apply to no-commit specs.

**Interrupted / error handling**: since no git state is written, there is nothing to clean up on failure — simply leave whatever partial spec tree exists on disk.

**Config resolution order** (same as `specTimestamp`): project-level `plan.commit` → global `modes.plan.commit` → default `true`.

### Shared concern — `ModeConfig` extension and validation

Both `specTimestamp` and `commit` extend `ModeConfig` globally and add a new optional `plan` block to `Project`. The config validator in `src/config.ts` must be updated to parse and validate both new fields, and the `Config`/`Project`/`ModeConfig` TypeScript types must be updated accordingly. The `jarvis config` command display should surface these settings.

### Out of scope

- Changing the branch/worktree naming convention (still untimestamped: `plan/<name>`, `.worktree/plan-<name>`).
- Any changes to patch mode.
- A new `--no-commit` CLI flag (config-driven only, per the intent).

## Interview turn 2

Code-level observations from reading `src/commands/plan.ts`, `src/config.ts`, and related files.

### Architecture of the `commit: false` path

`createPlanWorktree` is called at `plan.ts:799` inside `if (!opts.skipGhCheck && isGitRepo)`. When the call is skipped, `worktreePath` stays `null`. Everything downstream (interview, draft, review, commits, PR creation) lives inside the block that runs only when `worktreePath` is non-null. So the no-commit path is structurally: **set `worktreePath = project.root`** (or a subdirectory thereof for the spec tree), skip the worktree-creation block, and then guard every `commitPlan*` / `ensureDraftPr` call with the resolved `commit` flag. The existing `skipGhCheck` test option already proves this shape is sound — no-commit is a production-grade variant of that path.

One concrete implication: `seedIntentFile` (lines 831–857) writes into `worktreePath`. With `commit: false`, that write target becomes `project.root`, which is correct — the spec lands under `project.root/spec/<name>/` directly.

### `--resume` is incompatible with no-commit plans

`prepareResume` (`plan.ts:275`) hard-checks for `.worktree/plan-<planName>`, the `plan/<planName>` branch, and remote branch existence. None of these exist in a no-commit plan. **Attempting `--resume` against a no-commit spec should fail fast with a clear error message** ("this spec was created with commit: false; use `jarvis run` instead"). This should be added to the out-of-scope list, and the error surface is worth a subspec task.

### `ensureUniquePlanName` — safe for no-commit

This helper (`plan.ts`) derives a unique name by checking for existing local branches and worktrees. With `commit: false`, no branch will be created anyway, so name collisions are less of a concern. The uniqueness check may produce harmlessly conservative names (e.g. appending a suffix) but will not fail.

### Config resolution helper

A single `resolvePlanFlags(cfg: Config, projectKey: string): { specTimestamp: boolean; commit: boolean }` function should centralize the two-level merge (project override → global default → hardcoded default). This keeps the call sites in `plan.ts` clean and the logic testable in isolation. The function should live in `src/config.ts` alongside the existing config helpers.

### `specTimestamp` timing

The resolved `specTimestamp` flag is needed at `plan.ts:995–996`, after the interview phase finalizes the plan name. The config is already loaded earlier (line 860 in the inline/file path). The same `cfg` value can carry the flag — no re-read is needed.

### `jarvis config` display

The `show` subcommand dumps the full config as JSON (`config.ts:116`), which will automatically surface the new fields once they are in the `Config` type. No additional display work is needed beyond ensuring the fields serialize correctly. The `set-plan-order` subcommand pattern (lines 143–162) can serve as a template if a `set-plan-flags` setter command is ever wanted, but that is not required by this intent.

### Type changes summary

- `ModeConfig` (`config.ts:93`): add `specTimestamp?: boolean` and `commit?: boolean`.
- `Project` (`config.ts:75`): add `plan?: { specTimestamp?: boolean; commit?: boolean }`.
- Config validator (around `config.ts:322`): parse and validate the new `plan` block on project entries, mirroring how `git?: boolean` is handled.
- `DEFAULT_CONFIG` (`config.ts:135`): no change needed — omitting the fields lets resolution fall through to the hardcoded defaults in `resolvePlanFlags`.

### No-commit and `ensureDraftPr` / PR body update calls

`ensureDraftPr` and `updatePrBody` are called in several places after draft and review phases. All of these must be guarded by `commit`. The PR summary printed to stdout at the end should be replaced with a local-path summary when `commit: false` (e.g., "Spec written to `spec/<name>/index.md`. Run with `jarvis run spec/<name>/index.md`.").

### Subspec breakdown suggestion

Given the scope, four subspecs seem right:
1. **Config types and validation** — `ModeConfig`, `Project`, validator, `resolvePlanFlags`, serialization.
2. **`specTimestamp` flag wiring** — guard at `plan.ts:995`, pass resolved flag through, update `specDirBasename` construction.
3. **`commit: false` plan flow** — skip worktree creation, skip all commits and PR calls, write spec to `project.root`, update final summary output.
4. **`--resume` guard for no-commit specs** — detect no-worktree case in `prepareResume` and emit a clear error.

## Interview turn 3

Final pre-draft pass. No blockers; adding a few concrete gaps that subspecs 1–4 must each close.

### Disk-directory collision for `commit: false`

Turn 2 notes that `ensureUniquePlanName` is "safe" for the no-commit path because it only checks branches and worktrees — and those checks are harmlessly conservative. The gap: with `commit: false`, two back-to-back runs of `jarvis plan my-feature` would both resolve to `spec/my-feature/` and the second would silently overwrite the first. Subspec 3 should add a disk-existence check: if `project.root/spec/<specDirBasename>/` already exists when `commit: false`, either suffix-bump the name (consistent with `ensureUniquePlanName`'s existing suffix logic) or exit with a clear error. The simpler option is the error, since the user can rename or delete the existing dir.

### `gh` CLI early-exit guard must also be skipped for `commit: false`

plan.ts performs an early `gh auth status` / availability check before the worktree block (the `skipGhCheck` path bypasses it in tests). With `commit: false`, no `gh` calls happen at all — the early check should be skipped for the same reason `createPlanWorktree` is skipped. Subspec 3 should confirm this guard is also gated on the resolved `commit` flag (or equivalently, gate it inside the same block as `createPlanWorktree`).

### `resolvePlanFlags` — take `Project | undefined`, not a string key

The proposed signature `resolvePlanFlags(cfg: Config, projectKey: string)` requires a secondary map lookup inside the function. plan.ts already has the resolved `Project` object at the point it would call `resolvePlanFlags` — passing the object directly avoids the double lookup and handles the case where no project is registered (pass `undefined`, fall through to global/hardcoded defaults). Revised signature: `resolvePlanFlags(cfg: Config, project: Project | undefined): { specTimestamp: boolean; commit: boolean }`.

### `commit: false` does not require supporting non-git repos

The use case is work repos that are git repos but where the user doesn't want to commit specs. `isGitRepo` will still be `true`; the `origin`/`gh` dependency is what's being removed. Subspecs 3 and 4 should document this scope boundary clearly so implementors don't over-generalize the no-commit path to non-git directories.

### Subspec dependency order

Subspec 1 (config types + `resolvePlanFlags`) must land before subspecs 2, 3, and 4, since all three call `resolvePlanFlags`. Subspecs 2 and 3 are independent of each other once subspec 1 is merged. Subspec 4 (`--resume` guard) depends on subspec 1 only for reading the `commit` flag to emit a specific error message; the structural check (no worktree/branch exists) is independent. The generated `index.md` should order them 1 → 2 → 3 → 4 with a note that 2 and 3 may be parallelized.
