---
name: review-feedback-auto-create-worktree
---
# Auto-create missing worktree in `review-feedback`

## Problem

`jarvis1 review-feedback <worktree-name>` fails immediately at v1/src/commands/review-feedback.ts:51 if `.worktree/<name>/` is missing in the target project root. This blocks the common cross-machine workflow: kick off `jarvis1 run` on one machine, then address PR review feedback from another machine where the worktree has never been materialized locally.

The branch is already on `origin` (jarvis pushes after every commit during `run`), so all the information needed to recreate the worktree is available.

## Desired behavior

When `review-feedback` is invoked and `.worktree/<worktreeName>/` does not exist under the resolved project root, jarvis should:

1. `git fetch origin` in the project root (best-effort, ignore failure as `ensureWorktree` already does).
2. If a branch named `<worktreeName>` exists locally or on origin, create the worktree at `.worktree/<worktreeName>/` checked out to that branch (mirroring v1/src/worktree.ts:46-71 — create local tracking branch from `origin/<name>` if needed, then `git worktree add --checkout`).
3. If no such branch exists locally or on origin, fail with a clear error like `jarvis1 review-feedback: no local or remote branch named <name>; cannot create worktree` (do **not** fall back to creating from base — `review-feedback` is for existing PR work, not net-new branches).
4. Proceed with the normal flow (clean check, PR lookup, agent run).

Cleanup is left to the user via `jarvis1 cleanup` later, same as today. No new flag — auto-create is the default.

## Scope notes

- `ensureWorktree` in v1/src/worktree.ts:17 already does almost exactly this, but it is keyed off a spec path and falls back to creating a branch from base when nothing exists remotely. Factor out a shared helper (e.g. `ensurePatchWorktreeForExistingBranch(projectRoot, worktreeName)`) that does only steps 1–3 above, and call it from `reviewFeedbackCommand` before the existence check. `ensureWorktree` can continue using its richer behavior for `jarvis1 run`.
- Plan worktrees (`plan-*` prefix) are out of scope — `review-feedback` already rejects them at v1/src/commands/review-feedback.ts:57.
- Disabled-git config: when `cfg.git === false`, worktrees aren't used at all. `review-feedback` should keep its existing behavior in that case (or fail with the same clarity it does today — confirm during implementation).
- Logging: emit a single stdout line such as `jarvis1 review-feedback: worktree missing; creating .worktree/<name> from origin/<branch>` so the user understands what happened.

## Acceptance hints (for the implementer)

- Unit/integration test: invoke `reviewFeedbackCommand` with a project where the branch exists on a fake `origin` but `.worktree/<name>/` is absent; assert the worktree is created and the rest of the flow runs.
- Unit/integration test: same setup but no remote branch; assert the clear error message and non-zero exit.
- Existing `review-feedback` tests for the "worktree exists" path should continue to pass unchanged.
- Update `README.md` and `v1/docs/worktrees-and-commits.md` (or wherever `review-feedback` workflow is documented) to mention the auto-create behavior.

## Out of scope

- Auto-resolving review threads, posting GitHub replies, editing PR metadata (already listed as v1 non-goals).
- Removing the worktree after the run.
- Any changes to `jarvis1 run` worktree resolution.
- A `--create` / `--no-create` flag — default is auto-create, no opt-out.

## Refinement

- Plan-prefix rejection runs before auto-create. The `worktreeName.startsWith("plan-")` guard at v1/src/commands/review-feedback.ts:57 moves above the existence/auto-create branch so we never fetch or create for plan worktrees.
- Plan-prefix rejection keeps its current error text and exit code 1; no change to the existing test.
- Helper lives in v1/src/worktree.ts and is exported as `ensurePatchWorktreeForExistingBranch(projectRoot: string, worktreeName: string): Promise<string>` returning the absolute worktree path.
- Helper reuses the existing private `branchExistsLocal` / `branchExistsOnOrigin` / fetch logic; refactor those to share with `ensureWorktree` rather than duplicate.
- Helper throws (not returns) on the no-branch case; message: `no local or remote branch named <name>; cannot create worktree`. Caller prefixes `jarvis1 review-feedback: ` when writing to stderr and returns exit code 1.
- Helper does not handle `currentBranchMatches(projectRoot, worktreeName)` (the "running from inside the patch worktree" shortcut in `ensureWorktree`); `review-feedback` is always invoked with a `<worktree-name>` arg that maps to `.worktree/<name>/`, never the project root itself.
- Auto-create path runs before `acquireWorktreeLock`; lock acquisition still targets the final `.worktree/<name>/` path. Rationale: cannot lock a directory that doesn't exist.
- `.worktree/` parent directory is created if missing (`mkdirSync(..., { recursive: true })`) before `git worktree add`; matches what `ensureWorktree` implicitly relies on when git creates the path.
- Stdout creation line is emitted **before** invoking git, with the form `jarvis1 review-feedback: worktree missing; creating .worktree/<name> from origin/<name>` when remote exists, or `... from local branch <name>` when only the local branch exists. Rationale: user sees intent before any slow git operation.
- `cfg.git === false`: keep current behavior — auto-create is skipped entirely and the existing "unknown worktree" path runs. Reason: with git disabled the harness never uses `.worktree/`, so materializing one is meaningless. No new error text.
- `git: false` check uses the same `loadConfig` call already present at v1/src/commands/review-feedback.ts:139; lift that load earlier (before the existence check) so the auto-create branch can consult it. No new config field.
- Project root for the helper is `opts.projectRoot` exactly as passed to `reviewFeedbackCommand`; no re-resolution via the projects registry inside the helper.
- Helper is invoked only when `existsSync(worktreePath) === false`; if it exists we keep the current fast path unchanged (no extra fetch, no extra stdout line).
- Newly created worktree starts clean by construction, so the existing `git status --porcelain` clean check still runs and is expected to pass on first creation.
- `currentBranch(worktreePath)` after auto-create returns `<worktreeName>` (the branch we just checked out), so the existing `branch === "HEAD"` and `branch.startsWith("plan/")` guards remain valid no-ops in this path.
- No symlink replay (`createWorktreeSymlinks`) for review-feedback auto-create. Rationale: review-feedback runs an agent for a fixed-purpose review fix, not a full build; symlink replay is a `jarvis1 run` concern. Pin if a caller needs build artifacts during review.
- Test file: extend `v1/test/review-feedback-command.test.ts` (existing fixture machinery already creates local git worktrees and stubs gh/agents).
- Test fixture for "branch on origin, no worktree": create a bare repo as `origin`, push the branch there from a scratch clone, then `git clone --bare`-style setup in `projectRoot` with `origin` pointing at the bare repo. Acceptable to simulate via `git init` + `git remote add origin <bare-path>` + a single commit on the named branch pushed to `origin`.
- Test for "no branch anywhere": same scaffold but never push/create the named branch; assert stderr contains `no local or remote branch named <name>` and exit code 1.
- Test for "git disabled config": pass `cfg.git === false` with no worktree directory; assert existing `unknown worktree` error fires and no fetch/branch lookup runs. Add a tracking flag through an injected helper to confirm the auto-create path was not entered.
- Helper is dependency-injectable on `ReviewCommandOptions` (e.g. `ensurePatchWorktreeFn?: (projectRoot: string, name: string) => Promise<string>`) so tests can stub without spinning up real git remotes for the happy-path assertions about the rest of the flow.
- Existing "missing worktree exits non-zero" test at v1/test/review-feedback-command.test.ts:98 is updated to stub `ensurePatchWorktreeFn` to throw the no-branch error, asserting the same exit code 1 and an error message containing `no local or remote branch named missing-one`. Rationale: the bare "unknown worktree" wording is replaced by the helper's clearer message; preserve coverage intent, not the literal string.
- Docs to update in the same subspec: `README.md` (the `### jarvis1 review-feedback workflow` section) and `v1/docs/worktrees-and-commits.md` (review-feedback section). Also touch `v1/docs/workflows.md` if it diagrams review-feedback preconditions. Skip `v2/docs/v1-behaviors.md` unless it explicitly catalogs the missing-worktree exit — defer to first consumer if catalog format is unclear.
- Doc wording: add one sentence stating that `review-feedback` auto-materializes `.worktree/<name>/` from `origin/<name>` (or a local branch) when missing, and errors with `no local or remote branch named <name>` otherwise. No new section heading needed.
- No changelog/release-notes file in this repo; skip that update.
- No new config keys, no new CLI flags, no new exit codes (reuse 1 for the no-branch error).
- Lock-file path remains `<.worktree>/<name>/.jarvis-lock` (via `getWorktreeLockPath`); created lazily on first `acquireWorktreeLock` after auto-create, unchanged.
- `gh` readiness check (`assertGhReady`) stays after auto-create and after the clean check. Rationale: avoid materializing a worktree only to fail on a missing `gh` — but `gh` is cheap and current ordering matches `jarvis1 run`'s structure; no reordering.
- Deferred to first consumer: behavior when `.worktree/<name>/` exists but checked out to a different branch than `<worktreeName>` — pin when a caller reports it. Current path already handles this by reading whatever branch is checked out; no new validation added.
- Deferred to first consumer: whether to prune stale `git worktree` registrations (`git worktree prune`) before `git worktree add` if a previous worktree at the same path was deleted manually — pin if test runs surface "already exists" errors.
- Behavior change to call out in the doc update: a plan-prefixed name (`plan-*`) invoked against a missing worktree previously emitted `unknown worktree`; after the guard reorder it emits the plan-rejection message instead. Same exit code 1; only the text changes. No existing test covers that case (the current `plan-*` test pre-creates the worktree), so no test update is needed for it, but mention in PR/commit message.
- Existing "plan-* worktree is rejected in v1" test (v1/test/review-feedback-command.test.ts:110) pre-creates the worktree before invoking the command, so the guard reorder leaves its assertions intact. Do not delete the pre-creation step; it documents the historic ordering and stays valid under the new ordering.
- `loadConfig` lift: move the `loadConfig` call to immediately after the plan-prefix guard and before the existence check, threading the result through to the existing usage site (currently line 139). Inject via `opts.loadConfigFn ?? loadConfig` exactly once per invocation; do not re-load.
- Existing "missing worktree exits non-zero" test (line 98) passes no `loadConfigFn`. Update it to inject `loadConfigFn: () => ({ ...defaults, git: true })`-style stub returning a minimal config so the lifted load does not hit disk. Alternatively, stub `ensurePatchWorktreeFn` to throw the no-branch error and assert; either approach works, but pick one and document it in the subspec.
- Test ordering invariant to assert: when `cfg.git === false` and worktree is missing, `ensurePatchWorktreeFn` is NOT invoked. Use the dependency injection to set a tracking boolean and assert it stayed false.
- Helper signature pin: `ensurePatchWorktreeForExistingBranch` is `async` and may throw a plain `Error` whose `message` is the no-branch text (no custom error class). Rationale: caller does `try { ... } catch (err) { stderr(err.message); return 1 }`, matching the existing `assertGhReady` pattern at line 98–101.
- Helper export: add to `v1/src/worktree.ts` public exports; no barrel/index file changes required since `worktree.ts` is imported directly by consumers.
- Shared internals refactor: extract `branchExistsLocal`, `branchExistsOnOrigin`, and the best-effort `git fetch origin` into module-private helpers (already module-private — just ensure both `ensureWorktree` and `ensurePatchWorktreeForExistingBranch` call the same functions, no duplication). No public API change for the existing helpers.
- Stdout line emission: route through `opts.io.stdout` in `reviewFeedbackCommand` (not the helper). Rationale: the helper is reusable and io-agnostic; the command owns user-facing output. Helper returns the path; command decides whether to log the creation line based on whether it took the auto-create branch.
- Stdout line content source: command knows `worktreeName`; for the "from origin/<name>" vs "from local branch <name>" distinction, the helper must surface which source it used. Options: (a) helper returns `{ path, source: "origin" | "local" }`, or (b) helper logs nothing and command pre-checks branch existence itself. Choose (a) — single source of truth for the lookup, avoids double-checking. Update signature: `Promise<{ path: string; source: "origin" | "local" }>`.
- Subspec count: this is a single atomic subspec. Tasks: (1) extract helper + refactor shared internals; (2) reorder plan-prefix guard above existence check; (3) lift `loadConfig`; (4) wire helper into command with stdout line; (5) update existing tests; (6) add new tests; (7) update docs. All ship together because they are interdependent (tests need helper, docs need final behavior).
- Acceptance criteria for the subspec must include: helper exists and is exported with the chosen signature; reorder verified by test of plan-* missing-worktree path producing plan-rejection text; happy-path test creates worktree via real local git remote; no-branch test asserts exact error substring; git-disabled test asserts auto-create not invoked; README and `v1/docs/worktrees-and-commits.md` updated; `bun run typecheck` and `bun test` green.
- Documentation home pin (per `v2/docs/documentation-standard.md` directive): the durable behavioral home for `review-feedback` is `README.md` (CLI workflow section) and `v1/docs/worktrees-and-commits.md` (worktree mechanics). Update both in the subspec, not in a follow-up. Skip `v1/docs/workflows.md` unless it currently mentions review-feedback preconditions — read it during implementation; if it does not, do not add new content there.
- Commit-message guidance for the subspec implementer: include "BEHAVIOR CHANGE: plan-* names with no existing worktree now emit plan-rejection text instead of unknown-worktree text" as a line in the commit body so reviewers see it without grepping diffs.

## Refine skip

No net-new refinement on this pass. The ledger above already pins helper signature/source, ordering (plan-prefix guard, loadConfig lift, auto-create before lock), error text, stdout wording, git-disabled behavior, test fixtures and injection points, doc homes, deferrals, and the behavior-change call-out. Further entries would restate.
