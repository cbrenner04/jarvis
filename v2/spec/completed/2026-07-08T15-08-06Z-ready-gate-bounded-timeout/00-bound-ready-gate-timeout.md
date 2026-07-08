# Bound ready-gate execFileSync calls to iterationTimeoutMs

`ready-gate.ts`'s `execFileSync` calls for `bun run ready`/`readyCommand` and
`bun run fix`/`fixCommand` have no `timeout`, so a hung command blocks the
calling ready gate (completion transition, pre-shrink, review baseline/final,
`maybeMarkReady`, plan-mode PR ready, triage, auto-integrate-base) forever.

## Decisions

- Scope is **every** `runReadyAndCommit`/`runReadyGateWithTier` call site in
  the repo, not a subset — the intent's own rationale ("every other jarvis
  operation gets a budget") is a completeness claim, so the eight sites below
  are an enumeration of the full set, not an arbitrary expansion.
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
- **Site → `agentLabel` mapping** (every call site the acceptance criteria
  cover):

  | Call site | `agentLabel` | Source |
  | --- | --- | --- |
  | `completion-pipeline.ts` completion gate | `"completion-ready"` | hardcoded at call site |
  | `completion-pipeline.ts` review-incomplete retry | `"review-incomplete"` | hardcoded at call site |
  | `completion-pipeline.ts` patch-complete | `"patch-complete"` | hardcoded at call site |
  | `review.ts` baseline | `"review-baseline"` | hardcoded at call site |
  | `review.ts` final (both retry passes) | `"review-final"` | hardcoded at call site |
  | `shrink.ts` pre-shrink | `"shrink-baseline"` | hardcoded at call site |
  | `pr.ts` `maybeMarkReady` | caller-supplied, defaults to `""` | `opts.agentLabel ?? ""` |
  | `auto-integrate-base.ts` | caller-supplied | `opts.agentLabel` |
  | `plan/pr.ts` `maybeMarkPlanPrReady` | caller-supplied (e.g. `"plan-review-actuator"`) | `opts.agentLabel` |
  | `triage.ts` | caller-supplied | existing `agentLabel` param |

  This resolves `patch-complete`/`review-incomplete` (previously listed with
  no owning call site): both are in `completion-pipeline.ts`, alongside
  `completion-ready`.
- Timeout-vs-signal disambiguation: a caught `execFileSync` error is only
  reported as "exceeded budget" when `err.signal === "SIGTERM"` **and**
  `err.killed === true` — Bun's `timeout` option kills with `SIGTERM` by
  default (no custom `killSignal` is passed at any call site here). A process
  killed by another signal (e.g. operator Ctrl-C delivering `SIGINT`) does
  not match and falls through to the existing generic failure path, so an
  interrupt is never misreported as a timeout.
- **Needs implementation-time verification:** the claim that Bun's
  `execFileSync` timeout guarantees `signal`/`killed` on the thrown error
  (not just a specific `code`) is confirmed for Node's `child_process` docs
  but not independently confirmed for Bun's `execFileSync` implementation.
  Implementation must verify this against the installed Bun version (a small
  script or unit test with a 1ms timeout is sufficient) before relying on it;
  if Bun's behavior diverges, fall back to whatever signal/flag Bun does set
  on timeout-induced kills.
- On timeout, the existing `FixCommandError`/`ReadyCommandError` classes are
  reused; only the message changes, from the generic `"<cmd> failed"` to
  `"<cmd> exceeded <timeoutMs>ms budget (gate: <agentLabel>)"` — rules out a
  new error subclass that existing `instanceof` branches don't handle, which
  would silently fall through to the non-retryable default.
- **Retry classification, decided explicitly:** `completion-pipeline.ts`
  already classifies both `FixCommandError` and `ReadyCommandError` as
  `retryable: true` (bounded by its existing attempt-count loop), independent
  of *why* the command failed. A timeout is one more reason the command
  failed; it inherits `retryable: true` unchanged, so a hung command is
  retried up to the pipeline's existing attempt cap before the gate hard-
  fails out — the "hard-fail" the intent asks for is satisfied by the
  pipeline's overall bounded-attempt behavior, not by special-casing timeouts
  as non-retryable. No new classification branch is added.
- Gate-site name in the timeout message reuses the `agentLabel` value from
  the mapping table above — rules out a second parallel "gate name" field
  duplicating `agentLabel`'s existing role.
- **Testability:** acceptance criteria are verified without waiting out
  `iterationTimeoutMs` by passing a small `timeoutMs` (e.g. 10ms) into
  `runReadyAndCommit`/`runReadyGateWithTier` against a test fixture command
  that sleeps longer than that (e.g. `sleep 1` or a Bun script with a busy
  loop), asserting the thrown error's message names the command and
  `agentLabel`. No test waits out the real `iterationTimeoutMs` default.
- Correction to the intent: `DEFAULT_CONFIG.iterationTimeoutMs` in
  `v1/src/config.ts` is `30 * 60_000` (30 min), not 10 min as stated in the
  intent. Docs and messages reflect the real default.
- This is one mechanical, uniform change — one required field
  (`timeoutMs`/`timeout`) and one message-format change — applied identically
  across the eight call sites above. Kept as a single subspec despite
  touching eight files because no site has divergent logic; each is a
  find-and-thread operation against the same contract.

## Out of scope

- CI job-level (`ci.yml`) timeout tuning.

## Acceptance criteria

- [x] A hung `bun run ready`/`readyCommand` invocation is killed once
      `iterationTimeoutMs` elapses instead of blocking the calling gate
      indefinitely.
- [x] A hung `bun run fix`/`fixCommand` invocation is killed once
      `iterationTimeoutMs` elapses instead of blocking indefinitely.
- [x] The resulting failure names both the exceeded command and the gate site
      (the call site's `agentLabel`) instead of a bare `ETIMEDOUT`/generic
      exec failure.
- [x] All `runReadyAndCommit`/`runReadyGateWithTier` call sites
      (completion-pipeline.ts, review.ts baseline, review.ts final,
      shrink.ts pre-shrink, pr.ts `maybeMarkReady`, auto-integrate-base.ts,
      plan/pr.ts `maybeMarkPlanPrReady`, triage.ts) pass `iterationTimeoutMs`
      from config rather than leaving the call unbounded.
- [x] `ready-gate.test.ts` and other existing ready-gate/completion/review/
      shrink/pr/triage tests stay green (behavior unchanged on non-timeout
      paths).

## Documentation updates

All docs below state the real default explicitly: `iterationTimeoutMs`
defaults to **30 minutes**, not the 10 minutes named in the intent.

- `v1/docs/config.md`: note the ready gate is bounded by `iterationTimeoutMs`
  (30 min default).
- `v1/docs/run-loop.md` and `v1/docs/worktrees-and-commits.md`: document the
  bounded ready-gate behavior and named timeout failure at the relevant gate
  descriptions, with the 30 min default.
- `v1/docs/operator-runbook.md`: record that a hung `bun run ready`/`fix` now
  hard-fails within the 30 min default budget with a named reason, instead of
  hanging.
- `v2/docs/v1-behaviors.md`: record the new bounded-timeout behavior (this
  changes existing ready-gate functionality, not purely net-new).
