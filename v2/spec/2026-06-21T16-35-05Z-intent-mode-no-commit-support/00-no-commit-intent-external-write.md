# No-commit intent writes to external ready-intents

## Problem

`jarvis1 intent` exits early under `modes.plan.commit: false`
(`v1/src/commands/intent.ts:404`) because its only output path commits the
split to a worktree and opens a draft PR. So the one mode unavailable in the
isolated `git: false` + `commit: false` setup that `run` and `plan` already
support. Plan already mirrors this: under `commit: false` it writes its tree to
`~/.jarvis/specs/<project-safe-id>/` and skips git/PR. Intent should mirror
plan's external-write path for parity (the intent's preferred direction over a
fail-fast guard, which already effectively exists at line 404).

## Decisions

- Under `commit: false`, write authored intents to
  `~/.jarvis/specs/<computeProjectSafeId(project)>/ready-intents/<name>.md` —
  the same external root plan uses, with `ready-intents/` as the sibling of
  per-spec dirs (mirrors the in-repo `<targetDir>/ready-intents/` ↔
  `<targetDir>/<specDir>/` layout). Rules out a separate `~/.jarvis/intents/`
  tree. Deferred to first consumer: ready-intents/ read path — pin when
  no-commit `plan` consumes it (no reader exists yet; the location is chosen for
  layout parity, not a built consumer).
- Under `commit: false`, stage in `~/.jarvis/specs/<id>/.jarvis-intent-stage`
  (external), not inside `project.root`, and grant the splitter
  `additionalReadDirs = [<external stage dir>]`. Rules out staging inside the
  live checkout, which pollutes the target repo that the isolated setup exists
  to leave untouched.
- Under `commit: false`, clear the external stage dir (rm-then-mkdir) at
  start-of-run, since it is a fixed path that survives a crash. Rules out
  reusing leftover stage content, which would poison the next run's filename /
  frontmatter validation. (The committed path's stage is a throwaway worktree,
  so it has no equivalent hazard.) On success the stage dir is removed.
- Thread `additionalReadDirs` through `runIntentSplitTurn` into its
  `createPlanInvocationBinding` `spawnOptions` (the binding already accepts
  `spawnOptions.additionalReadDirs`). Rules out a fork of the split turn.
- Under `commit: false`, allow an absolute `stagingDir` (and matching prompt
  `workdir`) so the agent writes to the external stage dir, since cwd stays
  `project.root`. Rules out keeping `stagingDir` worktree-relative.
- Under `commit: false`, run two boundary assertions (mirroring plan's
  no-commit path, which guards both checkout and external root):
  - **Target-repo boundary over `project.root`:** assert the splitter wrote no
    stray files into the live checkout (cwd is `project.root`). Rules out
    leaving checkout pollution undetected — the whole point of the isolated
    setup. Detected without `git status --porcelain` (unavailable under
    `git: false`).
  - **External-root boundary:** scope the rogue-write scan to the stage dir
    only. Rules out verbatim reuse of `assertNoCommitExternalSpecBoundary`,
    whose single-allowed-spec-dir semantics would flag the legitimate siblings
    under `~/.jarvis/specs/<id>/` (`ready-intents/`, the stage dir, prior
    no-commit plan `*-<slug>/` dirs). Checkout pollution is covered by the
    `project.root` check above.
  - The stage-*content* checks (filenames, frontmatter `name:`,
    `## Prerequisites`) are factored out as a reusable helper, separate from the
    non-reusable root scan.
- Under `commit: false`, skip worktree, branch, base-branch lookup, commit,
  push, and PR; use `project.root` as the agent cwd (mirror plan no-commit).
  Rules out reaching `ensureDraftPr`, which is what fails under `commit: false`.
- Under `commit: false`, `name:` collisions check the external
  `ready-intents/`; same hard-error-before-move semantics as the committed path.
- Under `commit: false`, multi-intent emission pre-checks all destination paths
  (collision + boundary) before renaming any file into `ready-intents/`, so a
  failure leaves zero partial writes. Rules out a per-file
  check-then-move loop, which could half-emit before aborting.
- Seed handling unchanged: file seeds still validated under
  `<targetDir>/wip-intents/` (read from the on-disk repo), inline seeds
  unchanged. File seeds read from on-disk `<targetDir>/wip-intents/` regardless
  of git presence; inline seeds need no repo structure. Relocating seed input is
  out of scope.
- Under `commit: true`, committed-path behavior is preserved: the threaded
  `additionalReadDirs` and absolute-`stagingDir` support are added as optional
  params defaulting to current behavior on shared functions
  (`runIntentSplitTurn`, `buildIntentSplitPrompt`). Rules out refactors that
  perturb committed runs; the commit-path tests pin this.

## Tasks

- In `v1/src/commands/intent.ts`, replace the `commit === false` early error
  with a branch: compute `externalRoot = join(jarvisConfigDir, "specs",
  computeProjectSafeId(project))`, `mkdirSync` it, clear (rm-then-mkdir) the
  external stage dir, and route staging + `ready-intents/` output there; skip
  worktree/branch/commit/push/PR. Remove the stage dir on success.
- Thread `additionalReadDirs` into `runIntentSplitTurn` and forward it to the
  binding `spawnOptions`; pass `[stageDir]` only on the no-commit path
  (optional param, defaults to current committed behavior).
- Allow an absolute external `stagingDir` in `runIntentSplitTurn` /
  `buildIntentSplitPrompt` so writes land outside the cwd (optional, defaults to
  current worktree-relative behavior).
- For no-commit, add two boundary checks: a `project.root` checkout scan (no
  stray files in the live checkout) and a stage-dir-scoped rogue-write scan —
  neither using `git status`. Factor the stage-content validation (filenames,
  frontmatter `name:`, `## Prerequisites`) into a reusable helper shared with
  the committed path.
- For no-commit, pre-check all destination paths (collision + boundary) before
  any `rename` into `ready-intents/`.
- Emit no-commit next-steps printing the absolute external
  `ready-intents/<name>.md` path and a runnable
  `jarvis1 plan --repo <project> <path>` per emitted intent.
- Add tests under `v1/test/` covering the no-commit path (external write
  location, no git/PR, non-git project root, `additionalReadDirs` grant,
  checkout-pollution abort, external rogue-write abort, collision abort, stage
  cleanup on success, next-steps output).

## Acceptance criteria

- [ ] Under `commit: false`, `jarvis1 intent` writes each authored intent to
      `~/.jarvis/specs/<project-safe-id>/ready-intents/<name>.md` and creates no
      git commit, push, branch, worktree, or draft PR (test asserts the external
      files exist and no `gh`/commit invocation occurs).
- [ ] Under `commit: false`, `jarvis1 intent` runs to success (exit 0) against a
      `project.root` that is not a git repository.
- [ ] Under `commit: false`, the splitter turn's spawn options carry
      `additionalReadDirs` containing the external staging directory (test
      captures the split turn's options).
- [ ] Under `commit: false`, a splitter write into the live checkout
      (`project.root`) aborts the run without moving any file into
      `ready-intents/`, detected without `git status`.
- [ ] Under `commit: false`, a splitter write outside the external staging
      directory aborts the run without moving any file into `ready-intents/`,
      detected without `git status`, while legitimate siblings under
      `~/.jarvis/specs/<id>/` (`ready-intents/`, prior plan `*-<slug>/` dirs)
      do not trip the scan.
- [ ] Under `commit: false`, an existing external `ready-intents/<name>.md`
      aborts as a hard collision error before any file is moved (no partial
      writes), with all destinations pre-checked before any rename.
- [ ] Under `commit: false`, the external stage dir is removed on a successful
      run.
- [ ] Under `commit: false`, success output prints the absolute external
      `ready-intents/<name>.md` path and a runnable
      `jarvis1 plan --repo <project> <path>` next-step command for each emitted
      intent.
- [ ] Under `commit: true`, committed-path behavior is preserved (optional
      params default to current behavior):
      `v1/test/intent-command.test.ts` commit-path and draft-PR tests stay green.
- [ ] The `intent: requires plan.commit=true ...` preflight error no longer
      fires under `commit: false` (the run proceeds via the no-commit path).
- [ ] `bun run typecheck` passes.
- [ ] `bun test` passes.

## Documentation updates

- `v1/docs/intent-mode.md`: document the `commit: false` path — authored intents
  written to `~/.jarvis/specs/<project-safe-id>/ready-intents/`, no commit/PR,
  and the absolute-path `jarvis1 plan` next-steps emitted instead.
- `v2/docs/v1-behaviors.md`: supersede the entry stating intent requires
  committed plan routing (currently: "Intent mode requires committed plan
  routing (`plan.commit=true`); ... exits with a targeted error") with the new
  no-commit behavior — external `ready-intents/` output, splitter granted
  `--add-dir` to the external stage dir (write-effective only for
  claude/codex), no git/PR. Name the failure mode: under `commit: false` the
  only writable target is the external stage reached via `additionalReadDirs`,
  which is read-only for cursor/opencode, so a fallback to those agents writes
  zero files and fails validation (inherited `--add-dir` limitation; fix out of
  scope). Update the phase table row for intent accordingly.

## Out of scope

- `run`/`plan` no-commit paths (already implemented; this aligns `intent`).
- Changing the default `modes.plan.commit`.
- How no-commit `jarvis1 plan` resolves the target repo from an external
  ready-intent path (no `repo:` binding in a ready-intent; operator passes
  `--repo`) — a plan-consumption concern, not intent's.
- Relocating raw seed input (`wip-intents/`) out of the target repo.
- Making cursor/opencode honor `--add-dir` writes — inherited
  `additionalReadDirs` limitation, not introduced here.
