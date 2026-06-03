---
name: test-coverage
---

# Add useful test coverage measurement

Jarvis needs real coverage visibility. The immediate ask is not command
topology or `ready` wiring; it is making coverage measurable enough that v2 and
shared code can grow without blind spots.

## Desired outcome

The repo can run coverage measurement for the code paths that are actively
growing: v2 source and root-owned shared code. The output should tell an
operator what was covered, where to find the report, and whether the covered
surface regressed below the chosen bar.

## Why this matters

- `v2/docs/v2-vision.md` calls for unit-tested business logic, coverage
  measurement, and blocking on drops.
- v2 tests are intended to live beside the source they cover; coverage should
  make that local testing discipline visible.
- Shared/root-owned code is real product surface now: prompt tooling, root
  scripts, and future shared runtime modules need coverage visibility distinct
  from v1's historical suite.
- A coverage report is more useful than a green pass/fail result when deciding
  whether a new v2 slice is actually tested.

## Scope

- Add coverage-capable test execution for v2-owned code.
- Add coverage-capable test execution for shared/root-owned code.
- Decide the initial coverage bar: hard threshold, no-regression guard, or
  measurement-only with an explicit follow-up if thresholding is not ready.
- Decide what counts as "shared" for coverage and encode that boundary in the
  tooling.
- Document how to run coverage and where reports appear.
- Add tests for the coverage command/configuration wiring where practical.

## Likely decision points

- Whether v1 joins coverage now or remains pass/fail until a dedicated cleanup.
  The minimum bar here is v2 plus shared/root-owned coverage.
- Whether Bun's built-in coverage output is enough for slice boundaries, or
  whether the repo needs a small wrapper/config layer.
- What belongs in the shared slice today. Likely candidates are repo-root
  scripts, prompt-related tests that exercise top-level prompt artifacts, and
  any source promoted out of `v1/` and `v2/`.
- Whether coverage enforcement starts as a threshold, a "no drop" rule, or
  initially just measurement/reporting.

## Acceptance criteria

- Running the v2 coverage path produces coverage output for v2-owned code.
- Running the shared coverage path produces coverage output for shared/root-owned
  code.
- Coverage output location and interpretation are documented.
- The chosen enforcement policy is documented and implemented, even if the first
  policy is explicitly measurement-only.
- Automated tests or focused fixtures cover enough of the coverage wiring to
  catch broken paths, globs, or config names.

## Out of scope

- Splitting root test commands into `v1`, `v2`, and shared slices.
- Updating `bun run ready` to call multiple test commands.
- Reorganizing unrelated test files just to make coverage boundaries prettier.
- A complete repo-wide coverage policy if that would stall v2/shared coverage
  visibility.

## Notes for drafting

- Keep this as repo-owned tooling and docs. No `jarvis1` runtime behavior should
  change just to add coverage measurement.
- Prefer simple, explicit paths over dynamic discovery.
- If command splitting is needed only as a mechanical prerequisite, keep it
  minimal here and leave the durable command contract to the separate test
  command intent.

## Refinement

- Use Bun's built-in `bun test --coverage` rather than a wrapper or c8 layer. Rules out: invented config layer when `--coverage` plus `bunfig.toml` covers slice scoping.
- v1 stays out of this spec's coverage path; coverage commands target v2 and shared only. Rules out: enlarging scope to drag v1's historical suite into thresholding now.
- "Shared" for coverage = `shared/**` plus repo-root `scripts/**`. Encoded as explicit include globs, not discovery. Rules out: dynamic walk that silently absorbs new top-level dirs.
- Initial enforcement policy is measurement-only with reports written to a known path; no threshold or no-drop guard this slice. Rules out: shipping a hard threshold before a baseline exists.
- Coverage commands are separate scripts (e.g. `test:v2 --coverage`-equivalents) and are not wired into `bun run ready`. Rules out: making `ready` slower or flakier before the policy is decided.
- Deferred to first consumer: exact report format (text vs lcov vs both) and on-disk report path — pin when the drafting spec wires the command.
- Deferred to first consumer: whether v2 and shared get one combined coverage run or two — pin when the drafting spec writes the scripts.

## Refine skip

No net-new load-bearing decision this turn. Tool, scope, shared-globs, enforcement policy, `ready` wiring, and the two report/runs deferrals are already recorded. Remaining choices (CI integration, exact script names, bunfig vs CLI mechanics) are inferable defaults or belong to the drafting spec's first consumer.
