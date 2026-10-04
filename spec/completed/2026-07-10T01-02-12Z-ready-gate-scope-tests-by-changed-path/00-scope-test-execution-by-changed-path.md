# 00 - Scope test execution by changed path

Add the mechanism the ready gate needs to run the same scoped test scripts CI
would run for a given diff, reusing `classifyChangedPaths`
(`scripts/ci-test-scope.ts`) instead of always running `bun run test`. This
subspec lands the mechanism only, opt-in via a new `baseBranch` field; no
existing call site passes it yet, so no default behavior changes here.

## Decisions

- Reuse `classifyChangedPaths` directly; no reimplementation of path
  classification in `v1/src`.
- New `resolveReadyTestScope(cwd, baseBranch)` in `v1/src/ready-gate.ts`
  resolves `git merge-base <baseBranch> HEAD`, then classifies paths from the
  union of `git diff --name-only <mergeBase>` and untracked files (e.g. `git
  status --porcelain` entries not already covered by the diff) — includes
  uncommitted changes and new, not-yet-tracked files already on disk when the
  gate runs, not just committed diff, since the gate's own pre-ready fix step
  may have produced uncommitted edits (including new files) by the time
  scoping is decided.
- Merge-base resolution failure (unfetched/unmerged base, ad-hoc checkout)
  returns `"full"` — mirrors CI's `RESOLVABLE=false` fallback.
- `RunReadyAndCommitOpts` and `runReadyGateWithTier`'s opts gain an optional
  `baseBranch?: string`. Omitted preserves current behavior exactly (always
  full, unscoped `bun run test`) — existing callers and tests are unaffected
  until a follow-up wires a value in.
- Scope crosses the `bun run ready` process boundary via a new
  `JARVIS_READY_TEST_SCOPE` env var (space-separated script names, `"full"`,
  or empty string for "no test scripts needed"), parsed the same way
  `JARVIS_READY_TIER` already is. Unset means "no scoping requested" (full,
  unscoped) — distinct from an explicit empty scope.
- `getReadyCommands` takes an optional test-scope param and substitutes one
  `bun run <script>` step per resolved script in place of the single
  `bun run test` step, in the same position, for both `fast` and `full` tiers.
  An empty scope (docs/specs-only diff) drops the test step entirely.
- Serial-retry-on-flake stays restricted to the unscoped `bun run test` step
  (`isTestStep` unchanged). Scoped per-surface scripts (`test:v1`, `test:v2`,
  …) get no serial retry — deferred to first consumer: the underlying
  `run-v1-tests.ts`/`run-v2-tests.ts`/`run-shared-tests.ts` runners have no
  serial-mode flag to retry into; pin when a scoped run actually flakes.

## Acceptance criteria

- [x] `resolveReadyTestScope(cwd, baseBranch)` returns `"full"` when the base
      branch's merge-base can't be resolved, and otherwise returns
      `classifyChangedPaths`'s result for the paths changed since merge-base
      (including uncommitted working-tree changes).
- [x] Given a merge-base with only `v1/**` files changed (tracked diff),
      `resolveReadyTestScope` returns the `v1`-surface scope (`test:v1` +
      `test:integration:v1`), not `"full"`.
- [x] Given a merge-base where the only change is a new, untracked file under
      `v1/**` (not yet `git add`ed), `resolveReadyTestScope` still includes
      that path in classification and returns the `v1`-surface scope, not
      `"full"`.
- [x] Given a diff touching both `v1/**` and `v2/**`, `getReadyCommands`
      substitutes one `bun run <script>` step per resolved script (e.g.
      `test:v1`, `test:v2`, `test:integration:v2`) in place of the single
      `bun run test` step.
- [x] `RunReadyAndCommitOpts.baseBranch` is optional; omitting it leaves
      `runReadyAndCommit`/`runReadyGateWithTier` behavior unchanged (full,
      unscoped `bun run test`), verified by existing `ready-gate.test.ts`
      staying green with no changes to those tests' opts.
- [x] Passing `baseBranch` sets `JARVIS_READY_TEST_SCOPE` for the `bun run
      ready` child process to the classified scope for that branch's diff.
- [x] `scripts/ready.ts`'s `getReadyCommands` runs one `bun run <script>` step
      per scoped test script (in place of `bun run test`) when
      `JARVIS_READY_TEST_SCOPE` names specific scripts, runs no test step when
      it names none, and runs unscoped `bun run test` when unset or `"full"`.
- [x] Existing `v1/test/ready-script.sandbox-unrunnable.test.ts` and
      `v1/test/ready-gate.test.ts` suites stay green (behavior unchanged for
      the unset-scope path).

## Documentation updates

None — this subspec adds an opt-in mechanism with no default-behavior change;
`v2/docs/v1-behaviors.md` is updated in 01 once a call site actually scopes.
