# 00 - Committed spec root selection

## Goal

Introduce one repo-aware source of truth for the committed in-repo spec root
used by plan mode so Jarvis can keep the generic default of `spec/` for normal
target repos while defaulting new Jarvis-repo committed specs to `v1/spec/`.

This slice is about path selection and validation only. It should not yet
rewrite every human-facing message or PR/body formatter that still prints
`spec/...`; those consumers are covered in the next subspec.

## Decisions

- The committed-spec-root decision must live behind one helper or routing layer,
  not duplicated across individual plan-mode call sites.
- The generic committed-spec default remains `spec/` for ordinary target repos.
- For this repository, committed plan authoring defaults to `v1/spec/`.
- `v2/spec/` remains out of scope for automatic routing in this change; reserve
  it for a later explicit workflow rather than inventing heuristics now.
- Existing root-level `spec/...` trees in this repository remain valid inputs
  for resume or run flows where the current code already supports them.
- The user should not need to run `jarvis1 plan` from inside `v1/` to get the
  Jarvis-repo default; if implementation wants to support that as an additional
  happy path, it must still keep repo-root invocation working.

## Task Checklist

- Add a helper that resolves the committed in-repo spec root from the target
  repo context before a new committed plan directory is created.
- Route new committed plan directory creation through that helper instead of
  hard-coding `worktreePath/spec/<spec-dir>`.
- Route committed-plan collision detection and resume lookup through the same
  helper so new `v1/spec/...` plans do not drift from existence checks.
- Preserve no-commit external plan storage under `~/.jarvis/specs/...` with no
  behavior change.
- Preserve compatibility for historical root-level `spec/...` trees in this
  repository rather than requiring migration.
- Add focused regression coverage for generic repos and for the Jarvis-repo
  routing case.

## Acceptance criteria

- [ ] New committed plan authoring for this repository creates and reuses spec
      directories under `v1/spec/<spec-dir>/`, not root `spec/<spec-dir>/`.
- [ ] Generic committed plan authoring for other target repos still defaults to
      `spec/<spec-dir>/`.
- [ ] The same committed-spec-root helper drives new-plan directory creation,
      collision detection, and committed resume existence checks.
- [ ] Legacy root-level `spec/<spec-dir>/...` trees in this repository remain
      resumable or otherwise readable where they were before this change.
- [ ] No-commit plan mode continues to use `~/.jarvis/specs/...` unchanged.
- [ ] Automated coverage exercises both the Jarvis-repo `v1/spec/` default and
      the generic `spec/` default.

## Documentation updates

- Update any developer-facing notes that describe the new committed-spec-root
  helper or routing rule if the implementation introduces a new module or
  convention that future contributors need to follow.
