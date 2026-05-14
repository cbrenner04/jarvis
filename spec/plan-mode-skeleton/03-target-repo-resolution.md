# 03 — Target-repo resolution shared with `jarvis run`

## Problem

`jarvis run` resolves the target repository through a documented order
(`docs/run-loop.md`, `docs/spec-guidance.md`): `--repo` flag → spec
`repo:` URL/slug matched against registered projects → spec path inside a
registered project → spec path inside any git checkout (ad-hoc) →
prompt/error. `jarvis plan` must use the **same** resolution rules so
users carry one mental model across modes, but plan mode's inputs differ:

- File mode has an intent file path (analogous to a spec path).
- Inline mode has only an inline string.
- Interactive mode has no positional input at all.

The intent file is **not** a spec, so its `repo:` line (if any) is not
treated as authoritative. The fallback chain still applies.

## Decisions

- **Extract a shared resolver.** The current resolver in `src/repo.ts`
  (or wherever it lives today) is wired into `jarvis run` and likely
  takes a parsed-spec object as input. Plan mode does not have a
  parsed spec in inline or interactive modes, so this subspec extracts
  a smaller core helper that both commands call. The extraction is
  not optional; do it as part of this subspec so plan mode and run
  mode share one code path from the start. The new shape is roughly
  `resolveTargetRepo({ repoFlag?, candidatePath? }): ResolvedRepo`,
  living in `src/repo.ts` and re-exported / imported by both
  `src/commands/run.ts` and `src/commands/plan.ts`. Run mode keeps a
  thin wrapper that derives `candidatePath` from the spec; plan mode
  derives it as below. Plan mode supplies the appropriate inputs:
  - `--repo` flag value if present.
  - **No spec `repo:` line.** Even in file mode, intent files do not
    carry a `repo:` directive at this stage. (We may revisit later if
    intent files start standardizing on one.)
  - Path used for "inside a registered project" / "inside a git checkout"
    walks:
    - File mode: the resolved intent file path.
    - Inline and interactive modes: the effective working directory
      (`--cwd` if provided, else `process.cwd()`).
- **Resolution failure exits `1`** with the same message text `jarvis
  run` uses, so users see a familiar error.
- **No persistence.** Plan mode never writes to the project registry.
  Ad-hoc resolution is allowed (matches `jarvis run`'s ad-hoc mode).
- **Stub exit timing.** Resolution runs **before** the stub exit. The
  ordering is: parse → resolve repo → log-server check (subspec 05) →
  stub exit (`2`). This way reviewers can confirm in this skeleton spec
  that resolution actually works end-to-end against their machine; if
  they pass `--repo nope`, they see the resolution failure (`1`), not
  the stub message (`2`).
- **No worktree resolution.** Worktree path computation is introduced
  in `spec/plan-mode-worktree-and-commits/`. This subspec stops at
  "we know which target repo we'd plan against."

## Implementation hints

- Land the extraction first: introduce `resolveTargetRepo` with the
  shape above, migrate `runCommand` to call it, and verify
  `bun test` is green before wiring plan mode in. Keep the diff
  reviewable by treating the extraction and the plan-mode wire-up as
  two commits inside this subspec's iteration.

## Tasks

- [ ] Extract `resolveTargetRepo({ repoFlag?, candidatePath? })` into
  `src/repo.ts` (or the existing resolver module). Migrate
  `runCommand` to call it. Existing run-mode tests must continue to
  pass with no behavior change.
- [ ] Wire repo resolution into `planCommand` after parsing succeeds,
  using the extracted helper.
- [ ] Log the resolved project (one stderr line: `plan mode: target
  project=<name> root=<path>`) for verification.
- [ ] Tests covering:
  - File mode: intent file inside a registered project → resolves to
    that project.
  - File mode: intent file outside any registered project but inside a
    git checkout → resolves ad-hoc.
  - Inline mode + `--cwd` inside a registered project → resolves to that
    project.
  - Interactive mode: same as inline.
  - `--repo <name>` overrides the path-walk fallback in all three modes.
  - Resolution failure exits `1` with the existing message text.
  - After successful resolution, the stub exit (`2`) still fires.

## Acceptance criteria

- [ ] Plan mode resolves the target repo using the same rules as `jarvis
  run`, in all three input modes.
- [ ] Resolution failures exit `1` with the same wording the user
  already sees from `jarvis run`.
- [ ] Successful resolution does not modify the project registry, the
  target repo, or any worktree.
- [ ] After successful resolution, the stub exit `2` still fires.
- [ ] `bun run typecheck`, `bun test`, `bun run check` all pass.

## Documentation updates

- None. Subspec 06 covers README and docs.
