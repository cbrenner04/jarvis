# 00 - Committed spec root selection

## Goal

Introduce one source of truth for committed in-repo spec placement in plan mode
so Jarvis can keep the generic default of `spec/` for normal target repos while
defaulting new Jarvis-repo committed specs to `v1/spec/`.

This slice is about path selection and validation only. It should not yet
rewrite every human-facing message or PR/body formatter that still prints
`spec/...`; those consumers are covered in the next subspec.

## Decisions

- The committed-spec-root decision must live behind one helper or policy layer,
  not duplicated across plan-mode call sites.
- That helper must answer two related questions:
  which root should new committed plans use, and which existing committed roots
  should resume/lookup accept for compatibility.
- The generic committed-spec default remains `spec/` for ordinary target repos.
- For this repository, new committed plan authoring defaults to `v1/spec/`.
- `v2/spec/` remains out of scope for automatic routing in this change; reserve
  it for a later explicit workflow rather than inventing heuristics now.
- Existing root-level `spec/...` trees in this repository remain valid inputs
  for resume or read flows where the current code already supports them.
- Repo-root invocation is not a hard requirement for this change. If the
  smallest defensible implementation requires users to run `jarvis1 plan` from
  `v1/` for Jarvis-owned work, that is acceptable as long as the workflow is
  explicit and the same routing policy is used consistently.
- Cleanup/archive behavior is out of scope here; this slice only establishes
  where new committed plan trees are created and which older roots remain valid
  for lookup.

## Task Checklist

- Add a helper that resolves the committed-spec location policy from the target
  repo context before a new committed plan directory is created.
- Route new committed plan directory creation through that helper instead of
  hard-coding `worktreePath/spec/<spec-dir>`.
- Route committed-plan collision detection through the same helper so new
  `v1/spec/...` plans do not drift from existence checks.
- Route committed-plan resume lookup through the same helper, including any
  Jarvis-repo legacy fallback roots the implementation decides to keep.
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
- [ ] One committed-spec location helper or policy drives new-plan directory
      creation, collision detection, and committed resume existence checks.
- [ ] Legacy root-level `spec/<spec-dir>/...` trees in this repository remain
      resumable or otherwise readable where they were before this change.
- [ ] No-commit plan mode continues to use `~/.jarvis/specs/...` unchanged.
- [ ] If Jarvis-repo plan authoring requires invocation from `v1/` rather than
      the repo root, that workflow is documented explicitly; if not, no such
      restriction is introduced in docs or prompts.
- [ ] Automated coverage exercises both the Jarvis-repo `v1/spec/` default and
      the generic `spec/` default.

## Documentation updates

- Update any developer-facing notes that describe the new committed-spec
  location helper or routing rule, including any repo-local invocation
  convention the implementation chooses.
