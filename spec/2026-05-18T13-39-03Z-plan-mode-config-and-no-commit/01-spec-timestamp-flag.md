# 01 — Wire `specTimestamp` flag into plan directory naming

Guard the `formatPlanSpecTimestamp()` call at `plan.ts:995` with the resolved `specTimestamp` flag so that, when `false`, the spec directory basename equals `planName` with no date prefix.

## Context

Currently `plan.ts:995` unconditionally produces a `YYYY-MM-DDTHH-mm-ssZ-<name>` directory basename. This subspec makes that behavior opt-in. The resolved flag comes from `resolvePlanFlags` (subspec 00).

`--resume` already handles both the timestamped and untimestamped forms via `stripPlanSpecTimestampPrefix`, so no resume changes are needed here.

## Tasks

- [ ] Call `resolvePlanFlags(cfg, project)` once, early in the plan flow (after the project is resolved, before `specDirBasename` is computed), and destructure at least `{ specTimestamp }` from the result. Because subspec 02 needs `commit` from the same call, prefer `const { specTimestamp, commit } = resolvePlanFlags(cfg, project)` so the call is not duplicated. If subspecs 01 and 02 are implemented in separate PRs, whichever lands second should update the destructuring to include both flags in the single call.
- [ ] At `plan.ts:995`, replace the unconditional `formatPlanSpecTimestamp()` call with:
  ```typescript
  const specDirBasename = specTimestamp
    ? `${formatPlanSpecTimestamp()}-${planName}`
    : planName;
  ```
- [ ] Confirm that the branch and worktree names (`plan/<planName>`, `.worktree/plan-<planName>`) remain untimestamped regardless of the `specTimestamp` flag (they already are — verify and leave unchanged)

## Acceptance criteria

- [ ] When `specTimestamp` resolves to `true` (default), the spec directory is created with the `YYYY-MM-DDTHH-mm-ssZ-<name>` prefix as before
- [ ] When `specTimestamp` resolves to `false`, the spec directory is created with only `<name>` as the basename (no timestamp prefix)
- [ ] Branch and worktree names are unaffected by `specTimestamp` in both cases
- [ ] A project with `"plan": { "specTimestamp": false }` in config produces an untimestamped spec dir for that project and a timestamped one for projects without the override
