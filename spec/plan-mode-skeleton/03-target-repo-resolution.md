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

- **Use the shared mode-entry resolver path.** `spec/cli-modes-and-config-v2/`
  centralizes the parse/setup → target-repo resolution → log-server preflight
  ordering for modes. This subspec wires plan mode into that shared entry
  path and supplies the plan-specific resolver inputs:
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

- Look for the shared mode-entry helper introduced by
  `spec/cli-modes-and-config-v2/01-shared-mode-entry.md`. The plan command
  should adapt `PlanInvocation` into that helper's inputs instead of adding a
  second resolver/preflight sequence.

## Tasks

- [ ] Wire repo resolution into `planCommand` after parsing succeeds, using
  the shared mode-entry helper from `spec/cli-modes-and-config-v2/`.
- [ ] Delete or avoid any plan-only duplicate of the resolver/preflight
  ordering.
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

- [x] Plan mode resolves the target repo using the same rules as `jarvis
  run`, in all three input modes.
- [x] Resolution failures exit `1` with the same wording the user
  already sees from `jarvis run`.
- [x] Successful resolution does not modify the project registry, the
  target repo, or any worktree.
- [x] After successful resolution, the stub exit `2` still fires.
- [x] `bun run typecheck`, `bun test`, `bun run check` all pass.

## Documentation updates

- None. Subspec 06 covers README and docs.
