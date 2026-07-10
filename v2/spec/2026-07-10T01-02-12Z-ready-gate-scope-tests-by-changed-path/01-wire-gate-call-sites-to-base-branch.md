# 01 - Wire gate call sites to a resolved base branch

Pass a resolved base branch into `baseBranch` (added in 00) at every existing
patch-mode ready gate call site, so each one scopes its test run the same way
CI would for the same diff. Plan mode and `auto-integrate-base.ts` are out of
scope — not named in the intent.

## Prerequisites

- 00 lands `baseBranch` on `RunReadyAndCommitOpts`/`runReadyGateWithTier` opts
  and the scoping mechanism it drives.

## Decisions

- Each site resolves its base branch via the existing `getBaseBranch(cwd)`
  helper (`v1/src/gh.ts`) — reusing the same source of truth CI's checks job
  and the rest of the patch-mode gates already use, not a new lookup.
- Where a site already computes `base`/`branch` earlier in the same function
  for another purpose (review baseline's later diff, review final, `pr.ts`'s
  `branch`), hoist that resolution above the gate call and reuse the same
  value rather than resolving twice.
- Review baseline and review final share the same resolved `baseBranch`
  string, but each independently re-runs `resolveReadyTestScope` against its
  own diff at its own call time — the two gates can therefore scope to
  different test scripts if the working tree changes between them (e.g. the
  fix step lands new edits between baseline and final).
- Call sites wired: completion transition (`completion-pipeline.ts`), review
  baseline and review final (`review.ts`), pre-shrink (`shrink.ts`),
  `maybeMarkReady` (`patch/pr.ts`), triage (`commands/triage.ts`).

## Acceptance criteria

- [ ] Completion-transition gate (`v1/src/modes/patch/completion-pipeline.ts`,
      `runCompletionReadyGate`) passes `baseBranch` resolved via
      `getBaseBranch`.
- [ ] Review baseline and review final gates (`v1/src/modes/patch/review.ts`)
      both pass `baseBranch`, resolved once and reused between them.
- [ ] Pre-shrink gate (`v1/src/modes/patch/shrink.ts`) passes `baseBranch`.
- [ ] `maybeMarkReady` (`v1/src/modes/patch/pr.ts`) passes `baseBranch`.
- [ ] Triage's ready gate (`v1/src/commands/triage.ts`,
      `triageRunReadyGate`) passes `baseBranch`.
- [ ] A diff touching only `v1/**` at one of these call sites runs `test:v1`
      (+ `test:integration:v1`) instead of the full aggregate suite; a diff
      touching `shared/**` still runs the full suite (`classifyChangedPaths`'s
      existing `shared/**` → full rule, unchanged).
- [ ] A diff touching only docs/specs (empty scope) run through one real gate
      call site (e.g. completion-transition) drops the test step entirely and
      the gate completes without error.
- [ ] `v1/test/ready-gate.test.ts` and each touched call site's existing test
      file stay green.

## Documentation updates

- `v2/docs/v1-behaviors.md`: update the entries describing `bun run test` as
  always the unconditional full aggregate (lines documenting the completion
  gate, `readyCommand`/`fixCommand` overrides, and the "aggregate test, no
  scoped slices" note) to record that these six gate call sites now scope the
  test step by changed path via `classifyChangedPaths`, falling back to full
  when the base can't be resolved; CI's own scoping is unchanged.
- Same doc: note that scoped per-surface test steps (`test:v1`, `test:v2`, …)
  run without the serial-retry-on-flake safety net the unscoped `bun run
  test` step has — a behavior regression traded for scoping, per 00's
  deferred-first-consumer decision.
