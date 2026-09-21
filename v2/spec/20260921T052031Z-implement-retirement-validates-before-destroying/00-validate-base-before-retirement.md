# 00 — Validate `--base` before stale-workspace retirement

Stale-workspace retirement (`resetStaleWorkspace` in `v2/src/commands/cleanup.ts`, called by `maybeResetStaleWorkspace` in `v2/src/commands/stale-reset-workspace.ts`) removes worktree, branches, and PR without checking that the rematerialization base survives retirement. A `baseRef` that names the branch being retired destroys the lane and then fails to rematerialize.

## Decisions

- Placement: inside the shared `resetStaleWorkspace`, immediately before `performAbandonmentSteps`, after every refusal gate and after the continuation verdict. Retirement is the only destructive path, so fresh dispatch, `no-op`, `continue`, and gate refusals never reach the new check and are unchanged.
- Shared placement changes every `resetStaleWorkspace` caller: CLI `run workflow implement|plan|intent` and daemon pipeline stages (`pipeline-workflow-preparation.ts`, `pipeline-execution.ts`). `jarvis cleanup --abandon` and merged-worktree cleanup do not go through it and are out of scope.
- Checked base is the write step's resolved `baseRef` (`ResetStaleWorkspaceOptions.baseRef`), whether explicit `--base`, inherited, or the default branch; undefined `baseRef` skips the check. Checking only explicit `--base` would miss the same collision through a pipeline-supplied base.
- Refusal is a `{ status: "refused", reason }` result, surfaced as `Cannot re-run incomplete spec: <reason>` (exit 1) with nothing destroyed; no new refusal channel.
- Resolve form is `git rev-parse --verify --quiet <base>^{commit}` in `projectRoot` (a real commit, not `^{tree}` as in `validateExplicitPlanBase`), reusing that helper's approach rather than a new resolver.
- Collision is by ref name, not SHA: `X`, `refs/heads/X`, `origin/X`, and `refs/remotes/origin/X` collide with retired branch `X`; SHA comparison would wrongly refuse a distinct branch at the same commit.
- `<remote>` is `origin` only, the sole remote retirement deletes from and prunes. Other spellings (`heads/X`, `remotes/origin/X`, `X@{upstream}`, `X~0`, other remotes) are not normalized and are out of scope.
- Refusal reason names both the `baseRef` value and the retired branch.
- `base_behind_origin` freshness (`checkBaseFreshness`, run by the implement builder before stale reset) is unchanged; it already precedes destruction.
- An unresolvable `baseRef` already fails before retirement (the `git rev-parse <baseRef>` in the gate section throws and `maybeResetStaleWorkspace` reports `Stale workspace reset failed:`); the new check re-verifies at the destruction boundary but that outcome is preserved, not new.

## Tasks

- [ ] Add base pre-validation (`^{commit}` resolve + name collision) before `performAbandonmentSteps` in `resetStaleWorkspace`.
- [ ] Tests.
- [ ] Docs.

## Acceptance criteria

- [ ] A new test in `v2/src/commands/cleanup.test.ts` drives `resetStaleWorkspace` with `baseRef` equal to the retired branch in each of `X`, `refs/heads/X`, `origin/X`, and `refs/remotes/origin/X` forms; each returns `refused` with a reason naming the base and the branch, and fails against the pre-fix code (reachable on main: retirement proceeds and destroys the lane).
- [ ] A new test uses a distinct branch at the retired tip's SHA as `baseRef` and asserts it is not refused and retirement proceeds.
- [ ] The collision tests use the real bare-origin fixture pattern from `cleanup.test.ts` (`git init --bare` origin, ~line 2824) and assert after refusal: worktree directory exists, local branch resolves, the branch resolves in the bare origin, and the injected runner recorded no `git worktree remove`, `git branch -D`, `git push origin --delete`, or `gh pr close` invocation.
- [ ] A preservation test with an unresolvable `baseRef` asserts the same nothing-destroyed observables; it stays green before and after this change (existing refusal path, not new behavior).
- [ ] A CLI-level test in `v2/src/commands/workflow.test.ts` re-runs implement with `--base` equal to the retired branch and asserts exit 1 with stderr `Cannot re-run incomplete spec:` naming the collision and no `Retirement destroyed artifacts:` block; fails against the pre-fix code.
- [ ] Existing successful retirement + rematerialize tests in `v2/src/commands/workflow.test.ts` and `v2/src/commands/stale-reset-workspace.test.ts` stay green.
- [ ] `bun run typecheck`, `bun run test:v2`, `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — base==branch refusal; validate-before-destroy; applies to pipeline stages too.
- `v2/docs/workflow-runner.md` — base pre-validation precedes destructive retirement steps in the stale-workspace preflight.
- `v2/docs/pipeline-execution.md` — pipeline stage stale reset shares the base pre-validation refusal.
- `v2/docs/v1-behaviors.md` — record the refusal and validate-before-destroy ordering.
