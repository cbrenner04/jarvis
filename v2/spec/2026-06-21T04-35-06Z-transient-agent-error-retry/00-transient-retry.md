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
  the result, and after the cap it returns as today's `kind: "error"`, so every
  caller's control flow is byte-for-byte unchanged.
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
  `isQuotaSignal`'s non-zero guard. Rules out matching transport phrases inside a
  successful run's output. Exit-`0` JSON transient envelopes (the Claude-adapter
  analogue of the quota envelope) are out of scope — `Deferred to first consumer:
  exit-0 transient-envelope reclassification — pin when a real sample needs it`.
- Transient patterns cover transport/API drops, not quota: connection
  closed/reset/refused-mid-stream, socket hang up, broken pipe (`EPIPE`/
  `ECONNRESET`), premature/stream close, and gateway/overloaded status
  (`502`/`503`/`504`/`529`, "service unavailable", "overloaded"). Seed list is
  best-effort/unverified like the quota patterns. Rules out folding these into
  `quotaQuotaPatterns`/`weakQuotaPatterns` (which route to agent *advancement*,
  not in-place retry).
- `503` overlaps `weakQuotaPatterns`, but weak-quota only applies later, at the
  mode layer, under a guard. At the spawn layer `503` stays `error`, so transient
  retries it in place first; only after the cap does the surviving `error` reach
  the mode layer where lenient weak-quota may still upgrade it. Rules out a design
  where the spawn-layer transient path and the mode-layer weak-quota path
  contend — they are ordered, not racing.
- Re-attempt is in-place at `runAgent`, bounded by a small fixed cap (a few
  re-attempts), immediate (no backoff). Rules out advancing the agent (the quota
  path), aborting (the terminal path), unbounded retry, and a configurable
  knob/backoff nobody has asked for. `Deferred to first consumer: making the cap
  or a backoff configurable — pin when an operator hits a real endpoint that needs
  it`.
- An aborted invocation (iteration/idle/run timeout or SIGINT — `stderr` begins
  `aborted: …`) is never re-attempted: if `opts.signal` is aborted, the result is
  returned as-is. Rules out a watchdog/SIGINT abort being mistaken for a transient
  drop and re-spawned past the kill the harness just issued.
- After the cap is exhausted the final non-zero result is returned as
  `kind: "error"` — no new persisted result kind. Rules out adding
  `kind: "transient"` to the `AgentResult`/`InvocationResult` unions (which would
  force every exhaustive switch in patch/plan/review/shrink to grow a case and
  risk silently changing their control flow).
- Each re-attempt is operator-observable via a new optional `AgentRunOptions`
  callback that callers may wire to their logger; patch emits a harness stderr
  line distinct from the quota-fallback strings. Rules out a silent retry an
  operator can't tell apart from a hang, and rules out coupling the low-level
  `runAgent` directly to a logger.
- Non-transient outcomes (`ok`, `quota`, `model_config`, persistent `error`) keep
  their current control flow, telemetry, and exit codes. Rules out perturbing the
  quota/model-config paths while adding the sibling class.

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
  with per-agent + shared transport pattern lists and the exit-`0` guard.
- Add an optional re-attempt-notice callback to `AgentRunOptions`
  (`v1/src/agents/types.ts`).
- In `v1/src/agents/spawn.ts`, wrap the single-spawn body so a settled
  `kind: "error"` that `isTransientSignal` matches and `opts.signal` has not
  aborted is re-attempted up to the fixed cap; fire the notice callback per
  re-attempt; return the eventual non-transient result or, at the cap, the last
  `error`.
- Wire the notice callback in patch (`v1/src/modes/patch/iteration.ts` via
  `createPatchInvocationBinding`) to a harness stderr line that reads distinctly
  from the quota-fallback strings; add the constant near
  `v1/src/quota-harness-messages.ts`.
- Tests (`v1/test/agents/quota.test.ts`, `v1/test/agents/spawn.test.ts`, fake
  binary): classifier truth table incl. exit-`0` false and quota/model-config not
  reclassified as transient; transient-then-success returns `ok` with no
  advancement; persistent transient returns `error` at the cap; aborted invocation
  not retried; re-attempt notice fires per retry.
- Docs: `v1/docs/quota-signals.md` (transient is a distinct sibling class),
  `v1/docs/agent-cli-failure-pipeline.md` (new step + extension point),
  `v2/docs/v1-behaviors.md` (transient-retry behavior + its bound).

## Acceptance criteria

- [ ] A non-zero agent exit whose diagnostics match a transient transport/API
  signal (e.g. "connection closed mid-response") is re-attempted on the **same**
  agent — not advanced to the next agent and not returned as a terminal error —
  and when the next attempt exits `0` the call returns `kind: "ok"` with no agent
  advancement (test).
- [ ] A persistently transient endpoint terminates: after a small fixed cap of
  re-attempts the call returns `kind: "error"` and the existing control flow
  (advance/fail, unchanged exit codes) runs as before; the test pins the cap so
  the bound — not an external limit — is what stops it (test).
- [ ] `isTransientSignal` returns false for `exitCode === 0`, and a strict-quota
  signal and a model-configuration signal are **not** reclassified as transient
  (test).
- [ ] An invocation aborted via `opts.signal` (timeout/SIGINT path, `stderr`
  beginning `aborted:`) is never re-attempted as transient (test).
- [ ] Each transient re-attempt is operator-observable through the new
  `AgentRunOptions` notice callback, and the patch harness line reads distinctly
  from the quota-fallback strings (`quota exhausted; falling back` /
  `probable quota-like error`) (test).
- [ ] Strict-quota and model_config classification and control flow are unchanged:
  `v1/test/agents/quota.test.ts` and `v1/test/agents/spawn.test.ts` stay green
  (behavior preserved; transient is additive on the residual-`error` path).
- [ ] `v1/docs/quota-signals.md`, `v1/docs/agent-cli-failure-pipeline.md`, and
  `v2/docs/v1-behaviors.md` record the transient class, its position in the
  classification order, the same-binding bounded re-attempt, and the cap.
- [ ] `bun run typecheck` and `bun run test` pass.
