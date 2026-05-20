# 00 — Allow `commit: false` plan runs in non-git directories

## Problem

Running `jarvis plan` against a registered project that is not a git checkout currently exits 1 with:

```text
commit: false requires a git repository
```

The guard lives at `src/commands/plan.ts:1063-1067`:

```ts
const isGitRepo = existsSync(join(project.root, ".git"));
// ...
if (commit === false && !isGitRepo) {
  opts.io.stderr("commit: false requires a git repository\n");
  return 1;
}
```

This was an explicit scope decision in the original `commit: false` work (`spec/completed/2026-05-18T13-39-03Z-plan-mode-config-and-no-commit/02-no-commit-plan-flow.md:60` — *"`commit: false` does not enable running `jarvis plan` in non-git directories — that use case is out of scope"*). The rationale was scope containment, not safety: the entry remained useful for the original target audience (work repos that *are* git checkouts but where specs should stay local).

In practice the surrounding `commit: false` code path does not depend on git:

- `worktreePath` is set to `project.root`; no `git worktree add` runs (`src/commands/plan.ts:1071-1074`).
- `seedIntentFile` writes `<project.root>/spec/<tempPlanName>/intent.md` as plain files; the eventual `renameSync` moves the spec tree into `~/.jarvis/specs/<project-safe-id>/<spec-dir>/` (`src/commands/plan.ts:1334-1359`).
- Every `commitPlan*`, `ensureDraftPr`, `getCurrentBranch`, and `safeUpdatePrBody` call is already gated behind `if (commit !== false)` / `if (commit) { ... }` (search hits include `src/commands/plan.ts:1295`, `1337`, `1363`, `1368`, `1666`, `2129`).
- `injectRepoLineIntoIndex` already falls back from `project.origin` to `project.key` when no origin is configured (`src/commands/plan.ts:2330-2333`), so non-git registered projects without an `origin` still get a usable `repo:` line.

The only effect of the guard today is to refuse a workflow that would otherwise work end-to-end. Removing it makes plan mode usable in registered non-git directories (e.g. the user's `genomics-stream` checkout, which is a directory tracked elsewhere but contains no `.git`).

## Scope

The change extends `commit: false` to non-git directories **for already-registered projects only**. Project resolution itself (in `src/resolve-project.ts`) is unchanged: ad-hoc resolution still walks parents looking for `.git`, so unregistered non-git directories will continue to fail at the resolution step with the existing "could not determine a target project" error before they ever reach the guard. This subspec deliberately does not relax that.

The `commit: true` path is also unchanged: it still requires a git repo and `gh` because it creates a worktree, branches, commits, and a draft PR. The `!isGitRepo` branch under `commit: true` already returns later via the worktree-creation path; nothing in this subspec touches that.

## Decisions (locked)

- **Remove the early-return guard at `src/commands/plan.ts:1063-1067` outright.** Do not replace it with a softer warning; the path works without git.
- **Do not weaken `resolveProject`.** Non-git, unregistered directories must still fail to resolve. The fix only applies when the user has already registered the project via `jarvis init` (or `jarvis config`).
- **Do not change `injectRepoLineIntoIndex`.** Its existing `project.origin ?? project.key` fallback (`src/commands/plan.ts:2330-2333`) is sufficient. A registered project always has a `key`; non-git registered projects typically have no `origin`, so the `repo:` line will use the project key, which is exactly what existing config-driven resolution loose-matches against.
- **Do not adjust the `commit: true` path.** It still needs `.git` for the worktree, and the existing failure modes (worktree creation, `gh`) already surface that.
- **Keep the `commit: false` `--resume` guard untouched.** That guard (`spec/completed/2026-05-18T13-39-03Z-plan-mode-config-and-no-commit/03-resume-guard.md`) rejects `--resume` for `commit: false` regardless of git state, which is still correct.
- **Documentation:** update `docs/plan-mode.md` and `docs/spec-guidance.md` to remove the implicit assumption that `commit: false` requires git, and to call out that the target directory must still be a registered project. `docs/run-loop.md` and `docs/config.md` mention `commit: false` only in passing and need no edits unless a touch lands during the implementation pass.

## Tasks

- [ ] Delete the `if (commit === false && !isGitRepo)` early return in `src/commands/plan.ts` (currently `src/commands/plan.ts:1063-1067`). Adjust the comment immediately above (`// commit: false requires a git repo`) and the comment at `src/commands/plan.ts:1069-1070` so they no longer claim git is required for `commit: false`.
- [ ] Confirm by reading `src/commands/plan.ts` that every `git`/`gh`/PR call on the post-guard path is still reachable only when `commit !== false` or `isGitRepo` is true. No behavioral changes needed; this is a read-only review of the existing gates around `getCurrentBranch`, `commitPlanRefine/Draft/Review/Blocker`, `ensureDraftPr`, `safeUpdatePrBody`, and `git branch -m`.
- [ ] Add a new test in `test/plan-command.test.ts` exercising `commit: false` against a registered project that is **not** `git init`'ed. Use the existing `setupRegisteredProject()` helper (which already creates a non-git project directory) plus a project-level override `projectConfig.plan = { specTimestamp: false, commit: false }`. Assert that `planCommand` no longer emits `commit: false requires a git repository` and that the harness log records `commit=false`. Use a stubbed agent (or `skipGhCheck`-style path) so the test stays hermetic and doesn't require a real agent CLI.
- [ ] Add a focused regression test asserting that the literal string `commit: false requires a git repository` is no longer produced anywhere in `src/commands/plan.ts`. A simple `readFileSync` + `expect(...).not.toContain(...)` check, mirroring the style at `test/plan-command.test.ts:116-122`.
- [ ] Update `docs/plan-mode.md`: in the `commit: false` paragraphs (around `docs/plan-mode.md:15`, `:23`, `:69`, `:123`, `:241`, `:451`) make it explicit that the target may be any registered project directory — git or not — and that the spec is written to `~/.jarvis/specs/<project-safe-id>/<spec-dir>/` regardless of the target's git state. Do not duplicate this point in every paragraph; one clear statement plus removal of any remaining git-implying language is enough.
- [ ] Update `docs/spec-guidance.md` § *External specs (no-commit)* (`docs/spec-guidance.md:25-41`, `:69`) so it no longer implies the target must be a git checkout. The `repo:` line discussion is unaffected — fall back to the project key/slug when `origin` is absent, which the code already does.
- [ ] Run `bun run typecheck` and `bun test` and confirm both pass before ticking the matching acceptance criteria.

## Acceptance criteria

- [x] `src/commands/plan.ts` no longer contains the string `commit: false requires a git repository`.
- [x] Running `jarvis plan` against a registered project whose root has no `.git` directory, with `modes.plan.commit: false` resolved (globally or per-project), proceeds past project resolution and the early guard rather than exiting 1 with the historical message. (Verified by the new `test/plan-command.test.ts` case.)
- [x] `commit: true` plan runs against a non-git directory still fail through the existing worktree/`gh` paths; no new code path is introduced for them and no existing test that exercises that failure changes its expected output.
- [x] Project resolution (`src/resolve-project.ts`) is unchanged: an unregistered non-git directory still produces the existing "could not determine a target project" outcome and never reaches the plan flow.
- [x] `docs/plan-mode.md` and `docs/spec-guidance.md` no longer imply that `commit: false` requires the target directory to be a git repo, and call out registration as the actual requirement.
- [x] `bun run typecheck` and `bun test` pass.

## Out of scope

- Loosening `src/resolve-project.ts` so unregistered non-git directories can be used ad-hoc.
- Any change to the `commit: true` plan path, including its worktree creation, branch handling, `gh` checks, and PR creation.
- Adding origin-detection for non-git directories. The existing `project.origin ?? project.key` fallback in `injectRepoLineIntoIndex` is sufficient.
- Touching `--resume` behavior for `commit: false`. The existing rejection is still correct.
- Changes to `jarvis run`. `jarvis run` against an external spec already resolves the target via the spec's `repo:` line and registered projects; it does not depend on the target being a git repo *unless* `git: true` is in effect, which is governed by separate logic.
- Changes to `data/prices.json`, telemetry, attribution rendering, or any unrelated cleanup in `src/commands/plan.ts`.
