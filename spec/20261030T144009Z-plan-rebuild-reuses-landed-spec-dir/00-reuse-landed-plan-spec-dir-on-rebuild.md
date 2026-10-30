# Reuse landed plan spec directory on rebuild

## Problem

`planSource` in `src/execution/publication-workflow-steps.ts` always sets `specDir` to a freshly minted `${timestamp}-${ready.name}` (`publication-workflow-steps.ts` ~646–647). A failed plan stage redispatch or `pipeline resume` rebuild therefore names a directory absent from the branch, duplicates durable trees on retry, and leaves draft/review paths (`specPath`, `landing.durablePath`, staged draft targets) pointing at a new timestamp while an older matching tree remains on `plan/<name>`.

## Decisions

- Git-enabled repo-spec plan only (`specsHome === "repo"`); external `~/.jarvis/specs/.../plans/<name>/` keeps mint-on-every-build — rules out a shared external reuse path.
- When the local `plan/<name>` branch exists, resolve reuse from **branch tip vs `baseRef`** via shared Git boundary (`src/shared/git.ts`), not from whatever happens to be checked out in a materialized worktree — rules out worktree-cwd listing that diverges before rematerialization and duplicates lookup at landing.
- A candidate directory basename must match `^\d{8}T\d{6}Z-<ready.name>$` exactly (same shape as `SPEC_TIMESTAMP_PREFIX` in `src/commands/cleanup-artifacts.ts` plus `-` and the ready-intent `name`) — rules out `*-<name>` suffix globbing or slug-only reuse.
- A candidate counts only when `<target>/<basename>/` is absent at `baseRef` and present on the plan branch (branch-added relative to the resolved plan `baseRef`) — rules out reusing a same-named timestamped tree already on the base ref (archived or merged spec) or on main before the plan branch existed.
- Among qualifying branch-added basenames, select the **newest** by UTC timestamp prefix (lexicographic max on the `YYYYMMDDTHHMMSSZ` prefix) — same survivor rule `plan-landing-removes-duplicate-spec-trees` uses when deleting sibling matching directories; export one shared selector for rebuild and landing cleanup — rules out two divergent “newest matching” implementations.
- When no qualifying branch-added directory exists (no local plan branch, empty delta, or no regex match), keep today’s fresh timestamp mint — rules out failing rebuild when the lane is new.
- Thread the chosen relative path through `specPath`, `landing.durablePath`, and the write step fields draft/review consume (including review `profileContext.specPath` under `.jarvis-plan-stage/` unchanged; durable path is the reused dir) — rules out reusing only `landing.durablePath` while prompts still target a minted path.
- Lookup and selection live in `planSource` / `publication-workflow-steps.ts` (or a co-located export that file owns); landing duplicate removal imports the same export — rules out re-deriving candidates inside `publication-landing.ts` only.
- `Deferred to first consumer: plan landing duplicate removal wiring to the shared export — pin when plan-landing-removes-duplicate-spec-trees implements.` (export and tests land here first.)

## Task checklist

- [ ] Add an exported selector (co-located with plan builder code) that implements the decisions above using injectable Git reads for tests.
- [ ] Call it from `planSource` when `git` is true before minting `timestamp`; pass resolved `baseRef` and `plan/${ready.name}`.
- [ ] Add regression tests in `src/execution/plan-workflow-steps.test.ts` (or `publication-workflow-steps.test.ts`) with a real git fixture: branch carries a landed matching dir, rebuild returns the same `specPath`/`landing.durablePath`; mint when branch missing; reject suffix-only slug and base-ref-preexisting same-regex tree.
- [ ] Update `docs/workflow-runner.md` and `docs/v1-behaviors.md` per intent.

## Acceptance criteria

- [ ] `plan-workflow-steps.test.ts` — regression test: git-enabled fixture with `plan/<name>` branched from base, an branch-added `spec/<olderTs>-<name>/` and `spec/<newerTs>-<name>/`, second `buildPlanWorkflowSteps` call selects `<newerTs>-<name>` for write `specPath` and `landing.durablePath`; fails against pre-fix code that always mints a third timestamp.
- [ ] `plan-workflow-steps.test.ts` — regression test: same setup with only branch-added matching dirs, first build after branch exists reuses the existing dir instead of minting a new basename; fails against pre-fix code.
- [ ] `publication-workflow-steps.test.ts` — `plan specs decision honors project specs: external like intent` and `plan-workflow-steps.test.ts` — `keeps specs-external ready-intent plans in external storage` stay green (external rebuild path unchanged).
- [ ] `plan-workflow-steps.test.ts` — regression test: no local `plan/<name>` branch (or no branch-added matching dir) still yields `specPath` matching `/^spec/\\d{8}T\\d{6}Z-<name>$/` distinct from any pre-seeded path; fails if reuse logic runs without a branch.
- [ ] `plan-workflow-steps.test.ts` — regression test: with `spec/not-a-timestamp-<name>/` branch-added on `plan/<name>`, rebuild still mints a fresh `^\d{8}T\d{6}Z-<name>$` path (suffix-only slug never selected); with only `spec/<ts>-<name>/` on `baseRef` and no branch-added matching dir, rebuild mints fresh — fails against pre-fix glob reuse or base-ref reuse.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:agent` passes for touched `src/execution/**` tests.

## Documentation updates

- `docs/workflow-runner.md` — in the plan preset / durable output paragraph, state that a retried git-enabled plan rebuild reuses the newest branch-added `<targetDir>/<UTC>-<name>/` on `plan/<name>` when one already exists instead of minting a fresh timestamp.
- `docs/v1-behaviors.md` — `[harness behavior change]` entry: plan rebuild on an existing repo-spec plan branch reuses the newest matching landed spec directory for `specPath` and landing; cite `src/execution/publication-workflow-steps.ts` and `docs/workflow-runner.md`.
