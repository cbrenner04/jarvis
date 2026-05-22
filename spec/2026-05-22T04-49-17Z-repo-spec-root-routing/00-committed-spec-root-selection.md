# 00 - Config-driven committed spec root

## Goal

Make the committed in-repo spec root for new plans a configured value resolved
through the existing plan-flag precedence, instead of a hard-coded `spec/`
literal scattered across plan-mode call sites.

This slice owns the config field, its explicit default, the resolution helper,
and routing new-plan directory creation, collision detection, and committed
resume existence checks through the resolved value. Human-facing text, commit
metadata, and PR rendering are covered in subspec 01.

## Decisions

- The committed-spec root for new plans is read from config via the existing
  `resolvePlanFlags(cfg, project)` precedence in `v1/src/config.ts`:
  `projects.<name>.plan.targetDir ?? modes.plan.targetDir ?? "spec"`.
- `targetDir` is added to both config blocks that already carry
  `specTimestamp`/`commit`: the global `modes.plan` object (`ModeConfig`) and
  the per-project `plan` object (`Project["plan"]`).
- The default is explicit: the default config writes `modes.plan.targetDir =
  "spec"` rather than relying solely on an in-code `?? "spec"` fallback. The
  in-code fallback still exists so older configs that predate the field keep
  working.
- The field is optional. Configs without it behave exactly as today, and
  ordinary target repos keep authoring committed plans under `spec/`. There is
  no config-version bump and no required-field migration.
- `targetDir` is a worktree-relative path. It must be validated as a relative
  path with no `..` traversal and no absolute prefix, because it is joined onto
  the plan worktree path.
- The resolved `targetDir` is computed once where the project and config are
  already resolved (the `resolvePlanFlags` call sites in plan orchestration) and
  threaded down alongside `worktreePath`/`specDirBasename`, not recomputed
  ad hoc per call site.
- No-commit external plan storage under `~/.jarvis/specs/...` is unaffected; the
  existing explicit `specDirPath` override continues to take precedence over the
  configured root.
- This change does not introduce Jarvis-repo detection logic. Routing this
  repository to `v1/spec` is a config value on its project entry, set in
  subspec 02, not code in this subspec.
- Legacy root-level `spec/...` trees in this repository remain valid inputs for
  resume/read where the current code already supports them; this slice does not
  migrate or rename them.

## Task Checklist

- Add `targetDir?: string` to `ModeConfig` and to `Project["plan"]` in
  `v1/src/config.ts`.
- Write the explicit default `modes.plan.targetDir = "spec"` into the default
  config.
- Extend `resolvePlanFlags` to resolve and return `targetDir` using the
  project-over-global-over-`"spec"` precedence.
- Parse and validate `targetDir` in the config loader for both the global
  `modes.plan` block and each project `plan` block, rejecting absolute paths and
  `..` traversal.
- Resolve `targetDir` once at the `resolvePlanFlags` call sites in plan
  orchestration and thread it into the plan phases.
- Route new committed plan directory creation through the resolved `targetDir`
  instead of a hard-coded `join(worktreePath, "spec", basename)`
  (`resolvePlanSpecDirPath` and its callers, plus the name-only and refine
  intent-path joins).
- Route new-plan collision detection (`deriveSpecName`) through the resolved
  `targetDir` so a configured `v1/spec` plan collides against its real location.
- Route committed-plan resume existence checks through the resolved `targetDir`
  so a resumed in-progress draft validates against the configured root.
- Preserve the `specDirPath` no-commit override precedence and
  `~/.jarvis/specs/...` storage with no behavior change.
- Add coverage for the precedence (project override, global default, built-in
  fallback) and for the relative-only `targetDir` validation.

## Acceptance criteria

- [ ] `modes.plan.targetDir` and `projects.<name>.plan.targetDir` exist in the
      config schema and round-trip through load/save.
- [ ] The default config contains an explicit `modes.plan.targetDir` of `"spec"`.
- [ ] `resolvePlanFlags` resolves `targetDir` as
      `projects.<name>.plan.targetDir ?? modes.plan.targetDir ?? "spec"`.
- [ ] A config without any `targetDir` key authors new committed plans under
      `spec/<spec-dir>/`, unchanged from today.
- [ ] A project whose `plan.targetDir` is `"v1/spec"` authors and reuses new
      committed plan directories under `v1/spec/<spec-dir>/`.
- [ ] New-plan directory creation, collision detection, and committed resume
      existence checks all use the single resolved `targetDir`, not a hard-coded
      `spec/` literal.
- [ ] `targetDir` validation rejects absolute paths and paths containing `..`.
- [ ] No-commit plan mode continues to use `~/.jarvis/specs/...` unchanged, and
      the explicit `specDirPath` override still takes precedence over the
      configured root.
- [ ] Automated coverage exercises the override, the global default, and the
      built-in fallback, plus the relative-path validation.

## Documentation updates

- Document the new `targetDir` config key (global and per-project), its explicit
  `"spec"` default, the resolution precedence, and the relative-path constraint
  in the developer-facing config notes.
