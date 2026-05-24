# Per-run --target-dir override for plan mode

## Problem

`plan.targetDir` is config-only (project → global → `spec`, via `resolvePlanFlags`
in `v1/src/config.ts`). A repo with both v1 and v2 spec roots can configure only
one default, so specs for the non-default root land in the wrong directory.
`jarvis1 plan` needs a per-run override.

## Decisions

- Flag name: `--target-dir <dir>`, plan mode only.
- Precedence: flag > project `plan.targetDir` > global `plan.targetDir` > `spec`.
- Reuse existing `validateTargetDir` (config.ts) for the flag value; on failure
  exit 1 with its message. No new validation rules.
- Value is repo-relative (same semantics as the config field). Absolute paths and
  `..` escapes are rejected by `validateTargetDir`.
- Scope is `jarvis1 plan` only. `cleanup` continues to resolve `targetDir` from
  config (`cli.ts:295`); it has no `--target-dir` flag in this change. Out of scope.

## Task checklist

- Add `--target-dir` to `FLAGS_WITH_VALUE` and thread `targetDir?: string` through
  `PlanInvocationCommon` in `v1/src/commands/plan-args.ts`.
- In `v1/src/commands/plan.ts`, pass the parsed flag to override the
  `resolvePlanFlags(...).targetDir` result before it reaches the draft/review/pr
  phases.
- Validate the flag value with `validateTargetDir`; surface its error and exit 1.
- Add `--target-dir <dir>` to the `plan` usage line in `v1/src/cli.ts`.

## Acceptance criteria

- [x] `jarvis1 plan --target-dir v1/spec <intent>` writes the spec tree under
  `v1/spec/<timestamp>-<slug>/` regardless of the resolved config `targetDir`.
- [x] With no `--target-dir`, behavior is unchanged (config/default resolution).
- [x] An invalid value (absolute path, or one containing `..`) exits 1 with the
  `validateTargetDir` error message; no spec dir is created.
- [x] `--target-dir` with no value exits 1 with `plan: missing value for --target-dir`.
- [x] `parsePlanArgs` unit tests cover: flag parsed, default when absent, missing
  value, invalid value.
- [x] `bun run typecheck` and `bun test` pass.

## Documentation updates

- `v1/docs/config.md` (`targetDir` section): note the `--target-dir` per-run
  override and its precedence over config.
- `v1/docs/spec-guidance.md`: mention `--target-dir` where `targetDir` routing is
  described.
- `v1/src/cli.ts` usage string (covered above) is the in-tool help.
