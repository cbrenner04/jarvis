# Bound ready-gate execFileSync calls to iterationTimeoutMs

`ready-gate.ts`'s `execFileSync` calls for `bun run ready`/`readyCommand` and
`bun run fix`/`fixCommand` have no `timeout`, so a hung command blocks the
calling ready gate (completion transition, pre-shrink, review baseline/final,
`maybeMarkReady`, plan-mode PR ready, triage, auto-integrate-base) forever.

## Decisions

- `RunReadyAndCommitOpts.timeoutMs` becomes a required field, passed as the
  `timeout` option on both `execFileSync` calls — rules out an optional field
  with a silent fallback, which would let a call site stay unbounded by
  omission.
- Every call site threads `iterationTimeoutMs` from config: `preflight.cfg` in
  `completion-pipeline.ts`, `opts.iterationTimeoutMs` already on
  `PatchReviewPhaseOptions` (review.ts) and `PatchShrinkPhaseOptions`
  (shrink.ts), `rawCfg.iterationTimeoutMs` in `plan/run.ts`, and a
  `loadConfig`-resolved value in `triage.ts` (mirroring its existing
  `resolveFixCommand` pattern) — no new hardcoded constant.
- `MaybeMarkReadyOpts` (pr.ts), `AutoIntegrateBaseOpts`
  (auto-integrate-base.ts), and `MaybeMarkPlanPrReadyOpts` (plan/pr.ts) each
  gain a required `timeoutMs: number` field threaded to their inner
  `runReadyGateWithTier`/`runReadyAndCommit` call.
- Timeout is detected via `err.killed === true` on the caught error, not
  `err.code === "ETIMEDOUT"` — Node/Bun's `timeout` option contract
  guarantees `killed`/`signal` on the thrown error but not a specific code.
- On timeout, the existing `FixCommandError`/`ReadyCommandError` classes are
  reused (so `completion-pipeline.ts`'s `instanceof`-based retry
  classification is untouched); only the message changes, from the generic
  `"<cmd> failed"` to `"<cmd> exceeded <timeoutMs>ms budget (gate:
  <agentLabel>)"` — rules out a new error subclass that existing `instanceof`
  branches don't handle, which would silently fall through to the
  non-retryable default.
- Gate-site name in the timeout message reuses the `agentLabel` value already
  passed at each call site (`completion-ready`, `review-baseline`,
  `review-final`, `shrink-baseline`, `patch-complete`,
  `review-incomplete`, or the caller-supplied label at
  triage/auto-integrate-base/plan sites) — rules out a second parallel
  "gate name" field duplicating `agentLabel`'s existing role.
- Correction to the intent: `DEFAULT_CONFIG.iterationTimeoutMs` in
  `v1/src/config.ts` is `30 * 60_000` (30 min), not 10 min as stated in the
  intent. Docs and messages reflect the real default.

## Out of scope

- CI job-level (`ci.yml`) timeout tuning.

## Acceptance criteria

- [ ] A hung `bun run ready`/`readyCommand` invocation is killed once
      `iterationTimeoutMs` elapses instead of blocking the calling gate
      indefinitely.
- [ ] A hung `bun run fix`/`fixCommand` invocation is killed once
      `iterationTimeoutMs` elapses instead of blocking indefinitely.
- [ ] The resulting failure names both the exceeded command and the gate site
      (the call site's `agentLabel`) instead of a bare `ETIMEDOUT`/generic
      exec failure.
- [ ] All `runReadyAndCommit`/`runReadyGateWithTier` call sites
      (completion-pipeline.ts, review.ts baseline, review.ts final,
      shrink.ts pre-shrink, pr.ts `maybeMarkReady`, auto-integrate-base.ts,
      plan/pr.ts `maybeMarkPlanPrReady`, triage.ts) pass `iterationTimeoutMs`
      from config rather than leaving the call unbounded.
- [ ] `ready-gate.test.ts` and other existing ready-gate/completion/review/
      shrink/pr/triage tests stay green (behavior unchanged on non-timeout
      paths).

## Documentation updates

- `v1/docs/config.md`: note the ready gate is bounded by `iterationTimeoutMs`.
- `v1/docs/run-loop.md` and `v1/docs/worktrees-and-commits.md`: document the
  bounded ready-gate behavior and named timeout failure at the relevant gate
  descriptions.
- `v1/docs/operator-runbook.md`: record that a hung `bun run ready`/`fix` now
  hard-fails within the budget with a named reason, instead of hanging.
- `v2/docs/v1-behaviors.md`: record the new bounded-timeout behavior (this
  changes existing ready-gate functionality, not purely net-new).
