# The gate-invocation slot is a global any lane can clear, so serialization does not hold

## Problem

**Partially landed 2026-09-08 ([#3617](https://github.com/cbrenner04/jarvis/pull/3617) hand-finish):** `releaseIterationGateSlot` now releases only through the owning tracker, so an unrelated lane's settle no longer clears a held slot; regression `an iteration without a gate does not release another lane's held slot` in `write-loop.test.ts` fails against the old code. Still open below: the exported unconditional `releaseAgentGateInvocationSlot`, the decorative cap, and finalization-repair release paths.

The gate-invocation serialization added for [[implement-gate-invocation-outlives-the-iteration-ceiling]] does not serialize. Its slot is an unowned module-global boolean, and any lane can release another lane's hold.

`v2/src/execution/write-loop.ts:512-521`:

```ts
let agentGateSlotHeld = false;
function tryAcquireAgentGateInvocationSlot(): boolean {
  if (agentGateSlotHeld) return false;
  agentGateSlotHeld = true;
  return true;
}
export function releaseAgentGateInvocationSlot(): void {
  agentGateSlotHeld = false;   // no owner check
}
```

`releaseIterationGateSlot` (`:2166-2172`) calls that unconditional release whenever the settling lane has **no** active gate:

```ts
function releaseIterationGateSlot(gateTracker?): void {
  if (gateTracker?.getActiveGate() !== undefined) { gateTracker.onAgentShellCommandComplete(); return; }
  releaseAgentGateInvocationSlot();
}
```

and `settleBoundedIteration` calls it on **both** exit paths (`:2182`, `:2187`), at the end of every iteration of every write loop — implement, plan, and intent alike.

**Failure scenario.** Lane A's agent starts `bun run test:v2` and acquires the slot. One second later lane B (any write loop, including a short plan iteration) settles an ordinary iteration with no gate, so `getActiveGate()` is `undefined` and the global flips to `false`. Lane C's agent then starts its own suite, acquires the now-free slot, and two full suites run concurrently — the exact condition the change exists to prevent.

No test covers this: the only release test drives the *active-gate* branch, so the clobber path is unexercised.

## Second defect: the cap is decorative

`MAX_CONCURRENT_AGENT_GATE_INVOCATIONS = 1` (`:510`) is exported but never read — the implementation is a boolean. Setting it to `2` changes nothing. A knob that cannot change behaviour is worse than an inlined constant, because operators and future specs will reason from it.

## Why this shipped

The lane settled 16/16 acceptance criteria with `check`, `typecheck`, `lint:md`, `test:v2` and `test:integration:v2` all green. Every criterion is about a single lane's behaviour or a same-process pair; none asserts that an *unrelated* lane's settle leaves a held slot intact. This is the repo's standing green-gate-over-a-no-op mode, applied to a concurrency guarantee.

## Decisions

- The slot is held by an identified owner and released only by that owner; an unrelated lane's settle is a no-op; rules out a bare global boolean that any settle path can clear.
- Release happens on shell-tool completion or iteration-loss abort for the owning tracker only, and a lane that never acquired never releases; rules out the current "no active gate ⇒ clear the global" branch.
- Acquisition is bounded by `MAX_CONCURRENT_AGENT_GATE_INVOCATIONS` read at the acquire site, so the constant is load-bearing; rules out an exported cap the implementation ignores.
- Every finalization and repair exit path releases an owned slot; rules out the `settleFinalizationRepair` leak that the clobber currently masks.
- The regression must exercise **cross-lane** interference — one tracker holding while a different tracker settles — not two calls on the same tracker; rules out a test suite that cannot observe this class.

## Acceptance criteria

- [x] A test proves a lane holding the slot still holds it after an unrelated write loop settles an iteration with no active gate; it fails against the current unconditional `releaseAgentGateInvocationSlot`. (Landed in #3617.)
- [ ] A test proves a lane that never acquired the slot cannot release it.
- [ ] A test proves setting `MAX_CONCURRENT_AGENT_GATE_INVOCATIONS` to 2 admits exactly two concurrent gate invocations and refuses the third; it fails against the current boolean.
- [ ] A test proves a finalization-repair iteration that acquired the slot releases it on every exit path.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — slot ownership and release points.
- `v2/docs/operator-runbook.md` — § Concurrency: state the guarantee accurately once it holds.
