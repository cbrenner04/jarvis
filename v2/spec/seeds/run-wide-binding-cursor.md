---
name: run-wide-binding-cursor
---

# v2 re-probes quota-exhausted agents on every write-loop iteration

## Problem

v2 resolves a fresh flat binding list per step invocation
(`resolveInvocationBindings` → `executeWithQuotaFallback`). The write loop
passes the same static `bindings` every iteration. When an agent returns
`quota`, the chain walks to the next binding for that invocation, but the
next iteration starts again at `agents[0]` / `rungs[0]`.

v1 patch avoids this with run-wide `activeAgents.shift()`: once an agent is
quota-demoted, it stays off the ladder for the rest of the run. v2's
`retry_later` stop posture helps when the whole chain is exhausted, but
does not skip head agents that are already known dead within a long run.

This wastes spawn latency and stderr noise once real agent processes and
quota classification land — especially multi-iteration writes and Phase 6
review-debate (many invocations per run).

## Scope (for plan → run)

- Persist **run-scoped escalation cursor** on the durable run record (or
  derive equivalently from committed attempt history): after quota demotes
  binding *k*, later invocations in the **same run** start the flat list at
  *k+1* (or equivalent agent-order suffix), not at binding 0.
- Apply at the seam **after** `resolveInvocationBindings(...)` and **before**
  `executeWithQuotaFallback` — slice or suffix the resolved list; do not
  change per-invocation inner/outer quota-only advance rules in
  `shared/invocation/execute.ts`.
- **Resume:** reloading a run restores the cursor from durable state;
  idempotent re-entry on a terminal run does not rewind it.
- **Success path:** when a binding returns `ok`, the cursor may stay at that
  binding (or last-good binding) for subsequent iterations — plan to pin
  whether success resets to head or sticks at the working binding.
- **Terminal full-chain quota:** unchanged — `invocation_failure` +
  `failureKind: "quota"`, operator `retry_later`; cursor does not imply
  automatic resume across calendar time.
- Tests with injected bindings proving: quota on head binding demotes for
  iteration 2+; resume reloads cursor; terminal exhaustion unchanged.

## Out of scope

- Inner rung cursor across invocations (explicitly out — each outer landing
  still starts at that agent's `rungs[0]` when the cursor lands on a new
  agent).
- Subscription/quota budget caps, cooldown timers, or cross-run agent
  disable (follow-on seed; natural Phase 7 companion).
- Stall / no-progress / idle outer-loop demotion (Phase 6 +
  `invocation-liveness.md` enforcement — may share the same run record
  field later, but not required in the first slice).
- Changing quota-only advance semantics in `executeWithQuotaFallback`.
- Real agent spawn or quota classifier work (prerequisite, not this slice).

## Decisions (seed-level — refine in plan)

- Cursor keys off **flat binding identity** (`agentId/adapterModel/priceKey`),
  not bare agent id alone — matches production binding ids and multi-rung
  chains.
- One cursor per **run** (not per workflow step) unless plan proves step
  isolation needs per-`stepId` cursors when Phase 5 multi-step resume is
  active.
- Demotion is **quota-only** in v1 — same trigger here; stall/no-progress
  advance is a separate follow-on.
- CLI `--agents` / `--agent`+`--model` override bypasses persisted cursor
  for that invocation (mirrors config bypass semantics in
  `agent-model-config.md`).

## Documentation updates

- `v2/docs/agent-model-config.md` — run-scoped binding cursor vs per-
  invocation flat-list construction.
- `v2/docs/write-behavior.md` — iteration resume + escalation memory.
- `v2/docs/state-store.md` — new durable field(s) or derivation rule.
- `v2/docs/v1-behaviors.md` — v2 contrast bullet for run-wide demotion parity.

## Prerequisites

- Phase 5 composed resolution shipped: `resolveInvocationBindings` +
  workflow-step execution path green (write→write preset).
- `invocation_failure_detail` / `bindingAttempts` persisted on quota stops
  (invocation-failure-reasons slice).
- Real agent bindings + quota classification at `shared/invocation/agents.ts`
  (or an explicit test seam decision if spawn lands in the same spec).
