# Bounded same-binding retry on transient transport errors

## Problem

A transient transport/API drop (e.g. "Connection closed mid-response") that exits
non-zero falls through to the generic `error` classification in
`v1/src/agents/spawn.ts` (`checkSettlement`, ~`:78-93`): order is `model_config`
→ `isQuotaSignal` → `error`. A connection drop matches none of the quota or
model-config patterns, so it settles as `kind: "error"`. The control flow then
treats it as a real failure — patch returns exit `3` (`iteration.ts` ~`:1153-1165`),
the shared loop (`shared/invocation/execute.ts` `executeWithQuotaFallback`) stops
on `error` as terminal. A momentary network blip thus burns the whole attempt even
though re-running the *same* agent would likely succeed.

A dropped connection is neither quota exhaustion (the next agent can't paper over
it — it's not this agent's fault) nor a code failure (nothing is wrong with the
work). It is a third class: re-attempt the **same** binding a bounded number of
times, then — only if it persists — let the existing control flow run unchanged.

This is the sibling classifier the existing quota heuristics imply but don't
cover. The retry's safety is the **bound**: a persistently-dead endpoint still
terminates (advance or fail) at the cap instead of spinning.

## Approach

Add a transient classifier alongside quota, and a bounded in-place re-attempt at
the single spawn chokepoint every agent and every mode flows through.

- **Classifier** — `isTransientSignal(name, exitCode, stderr)` in
  `v1/src/agents/quota.ts` (sibling to `isQuotaSignal`), per-agent + shared
  transport patterns, exit-`0` guard returns false (mirrors `isQuotaSignal`).
- **Retry locus** — `runAgent` in `v1/src/agents/spawn.ts` is the one path all
  five adapters and all modes (patch, plan, review, shrink) reach. Re-attempting
  there means no mode loop, no binding factory, and no `AgentResult`/
  `InvocationResult` union changes: a transient is retried before it ever becomes
  the result, and after the cap it returns as today's `kind: "error"`. Caller
  control flow keyed off the *returned result* is unchanged — but a retry re-runs
  the spawn body, so any **per-spawn callback** (`onSpawned`) fires once per
  attempt. That is not byte-for-byte transparent for callbacks with side effects;
  see the `onSpawned` re-entry decision below.
- **Observability** — re-attempts surface through a new optional
  `AgentRunOptions` callback so a retry is distinguishable from a quota fallback
  and from a hang; patch wires it to a harness stderr line.

## Decisions

- Transient is a distinct class evaluated **only on the residual `error`** —
  after `model_config` and strict `isQuotaSignal` have already claimed their
  results. Order: `model_config` → `quota` → transient retry → `error`. Rules out
  classifying transient before quota (would retry a quota-exhausted agent in place
  instead of advancing to the next).
- `isTransientSignal` returns false when `exitCode === 0`, mirroring
  `isQuotaSignal`'s non-zero guard. This is sound for the primary case: the
  default agent (Claude) surfaces a mid-response transport drop as a **non-zero
  process exit**, not an exit-`0` JSON error envelope, so the classifier engages
  where it must. Rules out matching transport phrases inside a successful run's
  output. Exit-`0` JSON transient envelopes (the Claude-adapter analogue of the
  quota envelope) are out of scope — `Deferred to first consumer: exit-0
  transient-envelope reclassification — pin when a real sample needs it`.
- Transient patterns cover transport/API drops, not quota: connection
  closed/reset/refused-mid-stream, socket hang up, broken pipe (`EPIPE`/
  `ECONNRESET`), premature/stream close, and gateway/overloaded status
  (`502`/`503`/`504`/`529`, "service unavailable", "overloaded"). Numeric status
  codes are **anchored** — matched only when co-occurring with error/http/status
  context (mirroring the existing anchored quota patterns), never as a bare number,
  so a status code printed incidentally in the agent's own work output does not
  trigger a re-run. Seed list is best-effort/unverified like the quota patterns.
  Rules out folding these into `quotaQuotaPatterns`/`weakQuotaPatterns` (which
  route to agent *advancement*, not in-place retry), and rules out bare-number
  matches that would re-run a genuinely failed attempt.
- `503` overlaps `weakQuotaPatterns`, but weak-quota only applies later, at the
  mode layer, under a guard. At the spawn layer `503` stays `error`, so transient
  retries it in place first; only after the cap does the surviving `error` reach
  the mode layer where lenient weak-quota may still upgrade it. Rules out a design
  where the spawn-layer transient path and the mode-layer weak-quota path
  contend — they are ordered, not racing.
- Re-attempt is in-place at `runAgent`, bounded by a fixed cap of **2 re-attempts
  (3 total spawns)**, immediate (no backoff). The cap is an internal constant in
  `spawn.ts`, not configurable. Rules out advancing the agent (the quota path),
  aborting (the terminal path), unbounded retry, and a configurable knob/backoff
  nobody has asked for. `Deferred to first consumer: making the cap or a backoff
  configurable — pin when an operator hits a real endpoint that needs it`.
- No backoff even for overload statuses (`502`/`503`/`504`/`529`/"overloaded"):
  an immediate capped retry that may re-hit a throttle still strictly beats
  today's behavior, where the same status is a terminal `error` that burns the
  attempt with zero re-tries. The cap guarantees termination, so the worst case is
  bounded. Rules out adding a backoff timer for a payoff nobody has measured.
- An aborted invocation is never re-attempted. The single key is
  `opts.signal?.aborted`, checked at the retry boundary: (a) once the signal is
  aborted, no further attempt starts; (b) an in-flight result that settled because
  of the abort is returned as-is. Rules out keying off the derived
  `aborted:`-stderr-prefix (it is a downstream artifact of abort handling, not the
  abort state), and rules out a watchdog/SIGINT abort being re-spawned past the
  kill the harness just issued.
- Idle age, iteration timeout, and run timeout span the **whole iteration**, not a
  single attempt, so they accrue across the dead gap between attempts and across
  the sum of attempts. An idle/iteration/run abort may therefore land mid-retry;
  this is acceptable — it terminates correctly via the existing abort path
  (`opts.signal?.aborted` halts the retry loop and the settled `aborted:` result
  is returned), and the cap independently bounds the retry count regardless of the
  timeout. Rules out per-attempt timer resets that would let a flapping endpoint
  outrun the iteration budget.
- `onSpawned` is contractually **fire-per-attempt**: each re-spawn fires it again
  with the new child's pid. `runAgent` does not own per-attempt resources the
  callback allocates, so it cannot clean them; instead the consumer must be
  re-entry-safe. Patch's `onSpawned` is made re-entry-safe by clearing any prior
  `descendantPollHandle` before assigning the new `setInterval`, and repointing
  `watchdogPgid` to the live child (the prior child is dead, so only the latest
  pid is a valid kill target). Rules out leaving patch as-is (a second attempt
  would leak the prior poll interval on a dead pid and the watchdog would track
  only the latest child), and rules out pushing handle cleanup into `runAgent`
  (which has no knowledge of the handle's lifecycle).
- After the cap is exhausted the final non-zero result is returned as
  `kind: "error"` — no new persisted result kind. Rules out adding
  `kind: "transient"` to the `AgentResult`/`InvocationResult` unions (which would
  force every exhaustive switch in patch/plan/review/shrink to grow a case and
  risk silently changing their control flow).
- Each re-attempt is operator-observable via a new optional `AgentRunOptions`
  callback, `onTransientRetry?: (info: { attempt: number; cap: number; agent:
  AgentName; exitCode: number }) => void`, fired once per re-attempt before the
  re-spawn (`attempt` 1-based, `cap` = 2). Patch wires it to the exact harness
  stderr line `transient transport error (exit <n>); retrying same agent (attempt
  <a>/<cap>)` via a new `harnessTransientRetryLine(exitCode, attempt, cap)` in
  `v1/src/quota-harness-messages.ts`. The phrase shares no substring with the
  quota strings (`quota exhausted; falling back` / `probable quota-like error`).
  Rules out a silent retry an operator can't tell apart from a hang, rules out a
  payload too thin to log the attempt/cap, and rules out coupling low-level
  `runAgent` directly to a logger.
- Discarded intermediate attempts' tokens go **unrecorded**: only the final
  settled result is what callers persist/meter, so a retried iteration's true
  spend exceeds what telemetry shows. "Telemetry unchanged" means the recording
  *path* is unchanged, not that retries are free — they are not. Accepting this
  rules out plumbing per-attempt usage accumulation through the spawn layer for a
  cost nobody has asked to track yet.
- Non-transient outcomes (`ok`, `quota`, `model_config`, persistent `error`) keep
  their current control flow, telemetry recording path, and exit codes. Rules out
  perturbing the quota/model-config paths while adding the sibling class.

## Retry trace (the contract)

Same agent, endpoint drops then recovers, cap = 2 re-attempts:

```
try1  exit≠0, transient signal  → re-attempt (1/2)
try2  exit≠0, transient signal  → re-attempt (2/2)
try3  exit 0                    → kind: "ok", returned; no agent advancement
```

Persistent drop, cap = 2:

```
try1  transient → re-attempt (1/2)
try2  transient → re-attempt (2/2)
try3  transient → cap reached → return kind: "error" → existing flow (advance/fail)
```

A strict-quota or model_config result on try1 is returned immediately — transient
retry never engages (it only sees residual `error`).

## Task checklist

- Add `isTransientSignal(name, exitCode, stderr)` to `v1/src/agents/quota.ts`
  with per-agent + shared transport pattern lists, anchored numeric-status
  matches, and the exit-`0` guard.
- Add the optional `onTransientRetry` callback to `AgentRunOptions`
  (`v1/src/agents/types.ts`) with the `{ attempt, cap, agent, exitCode }` payload.
- In `v1/src/agents/spawn.ts`, extract the single-spawn body and wrap it in a
  retry loop with the fixed cap of 2 re-attempts: a settled `kind: "error"` that
  `isTransientSignal` matches re-spawns iff `opts.signal?.aborted` is false; fire
  `onTransientRetry` per re-attempt; return the eventual non-transient result or,
  at the cap, the last `error`. The whole-iteration timers (`opts.signal`) are not
  reset across attempts.
- Add `harnessTransientRetryLine(exitCode, attempt, cap)` to
  `v1/src/quota-harness-messages.ts` and wire patch
  (`v1/src/modes/patch/iteration.ts` via `createPatchInvocationBinding`) to emit
  it through `onTransientRetry`; the line shares no substring with the
  quota-fallback strings.
- Make patch's `onSpawned` re-entry-safe (`v1/src/modes/patch/iteration.ts`):
  clear any existing `descendantPollHandle` before assigning the new
  `setInterval`, and repoint `watchdogPgid` to the live child.
- Tests (`v1/test/agents/quota.test.ts`, `v1/test/agents/spawn.test.ts`, fake
  binary): classifier truth table incl. exit-`0` false, anchored status (bare
  number not matched), and quota/model-config not reclassified as transient;
  transient-then-success returns `ok` with no advancement; persistent transient
  returns `error` at the pinned cap of 2; aborted invocation not retried;
  `onTransientRetry` fires once per retry with the expected payload; a second
  spawn does not leak the prior `descendantPollHandle`.
- Docs: `v1/docs/quota-signals.md` (transient is a distinct sibling class),
  `v1/docs/agent-cli-failure-pipeline.md` (new step + extension point),
  `v2/docs/v1-behaviors.md` (transient-retry behavior + its bound).

## Acceptance criteria

- [x] A non-zero agent exit whose diagnostics match a transient transport/API
  signal (e.g. "connection closed mid-response") is re-attempted on the **same**
  agent — not advanced to the next agent and not returned as a terminal error —
  and when the next attempt exits `0` the call returns `kind: "ok"` with no agent
  advancement (test).
- [x] A persistently transient endpoint terminates: after the fixed cap of 2
  re-attempts (3 total spawns) the call returns `kind: "error"` and the existing
  control flow (advance/fail, unchanged exit codes) runs as before; the test
  asserts exactly 3 spawns so the bound — not an external limit — is what stops it
  (test).
- [x] `isTransientSignal` returns false for `exitCode === 0`, returns false for a
  bare numeric status with no error/http context (anchored match), and does not
  reclassify a strict-quota signal or a model-configuration signal as transient
  (test).
- [x] An invocation whose `opts.signal` is aborted (timeout/SIGINT path) is never
  re-attempted as transient — neither when already aborted at the retry boundary
  nor when the in-flight result settled as `aborted:` (test).
- [x] Each transient re-attempt fires `onTransientRetry` once with
  `{ attempt, cap, agent, exitCode }`, and the patch harness line
  (`transient transport error (exit <n>); retrying same agent (attempt <a>/<cap>)`)
  shares no substring with the quota-fallback strings (`quota exhausted; falling
  back` / `probable quota-like error`) (test).
- [x] Patch's `onSpawned` is re-entry-safe: a second spawn within one iteration
  clears the prior `descendantPollHandle` (no leaked interval on a dead pid) and
  repoints `watchdogPgid` to the live child (test).
- [x] Strict-quota and model_config classification and control flow are unchanged:
  `v1/test/agents/quota.test.ts` and `v1/test/agents/spawn.test.ts` stay green
  (behavior preserved; transient is additive on the residual-`error` path).
- [x] `v1/docs/quota-signals.md`, `v1/docs/agent-cli-failure-pipeline.md`, and
  `v2/docs/v1-behaviors.md` record the transient class, its position in the
  classification order, the same-binding bounded re-attempt, and the cap.
- [x] `bun run typecheck` and `bun run test` pass.
