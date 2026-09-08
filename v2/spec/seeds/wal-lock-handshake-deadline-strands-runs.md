---
name: wal-lock-handshake-deadline-strands-runs
---

# A 10s subprocess handshake in the WAL test converts machine load into a non-resumable strand

## Problem

`v2/src/persistence/state-store-wal-concurrency.test.ts` spawns a real subprocess that takes a SQLite write lock and prints a `jarvis-lock-held` marker. `waitForLockHeld` (`:197`) gives that marker a **fixed 10-second** wall clock:

```ts
async function waitForLockHeld(subprocess, timeoutMs = 10_000): Promise<void> {
  …
  reject(new Error(`lock holder did not report ${LOCK_HELD_MARKER} within ${timeoutMs}ms`));
```

That deadline covers Bun process startup, module load, opening the database and beginning a transaction — all scheduled against whatever else is running. `bun run test:v2` executes files concurrently by design (10 workers observed), so the deadline is measured under exactly the contention the suite creates. The test's own assertions are not timing-sensitive; only this startup handshake is.

## Why it matters more than an ordinary flake

When it fires inside the ready gate, finalization runs its base-ref reproduction probe on the **same loaded machine**, the same test flakes again on `main`, and the harness correctly concludes "these paths also reproduce on base" — settling **`ready_gate_out_of_scope`**, which is `retryable: false` / `nextAction: "stop"`. A correct, complete run is stranded with no resume path, and the runbook explicitly says resume cannot clear an unchanged out-of-scope settlement.

So a fixed startup deadline in one test is upgraded into a terminal, non-resumable failure of unrelated work.

## Evidence (2026-09-08, one session)

Five failures, all under full-suite runs, on four different branches — none of which touch `v2/src/persistence/` in any meaningful way (one added a single line to `log-stream.ts`, the rest nothing):

| branch | outcome |
| --- | --- |
| `…-implement-gate-invocation-iteration-budget` | hand-verified, re-run clean |
| `…-run-review-finalization…` (slice 1) | hand-verified, re-run clean |
| `…-run-review-finalization…` (slice 2) | hand-verified, re-run clean |
| `…-retire-module-boundary-surface-split` (gate) | **stranded run `6dc830ec` as `ready_gate_out_of_scope`**, `readyGateOutsidePaths: ["v2/src/persistence/state-store-wal-concurrency.test.ts"]` |
| `…-retire-module-boundary-surface-split` (hand re-run) | reproduced again |

Always the same test and the same message: `lock holder did not report jarvis-lock-held within 10000ms`.

In isolation on an idle machine it is solid — 4 pass / 0 fail, run three times consecutively on the branch, and 4 pass / 0 fail on `main`. The failure is contention, not correctness.

## Decisions

- The lock-acquisition handshake does not carry its own short wall clock; the file's existing per-test timeout is the only bound, so a slow subprocess start under load fails the suite's own deadline rather than a private 10s one. Rules out raising 10s to a larger constant, which only moves the threshold a busier machine will still cross.
- If a bounded wait is retained for diagnosis, its budget is derived from observed subprocess-start cost with substantial headroom, and its failure message states that the deadline is a startup bound rather than a lock-contention result. Rules out a message that reads as a WAL-behaviour failure when it is a scheduling one.
- The test asserts lock **behaviour**, not startup latency; nothing in its acceptance depends on the marker arriving quickly. Rules out treating handshake latency as part of the contract under test.
- Scope is this handshake. The broader defect — a load-induced flake becoming a non-resumable `ready_gate_out_of_scope` because the base-ref probe runs under the same load — stays with [[coscheduled-test-pair-strands-runs-terminally]]; this seed removes one reliable trigger, it does not fix that class. Rules out conflating the two.

## Acceptance criteria

- [ ] A test proves `waitForLockHeld` no longer rejects on a private fixed wall clock — a lock holder that reports its marker later than the former 10s budget still satisfies the wait; it fails against the current `timeoutMs = 10_000` rejection.
- [ ] `v2/src/persistence/state-store-wal-concurrency.test.ts` passes when run concurrently with the rest of `test:v2` on a loaded machine, repeated across consecutive runs.
- [ ] The existing WAL assertions — second writer commits without `database is locked`, and the observed wait reflects the holder's hold time — are unchanged and still green.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/test-writing.md` — a test that spawns a subprocess must not put a short private wall clock on its startup handshake; the suite runs files concurrently, so such deadlines measure machine load.
- `v2/docs/operator-runbook.md` — § Concurrency: name this test as a known load-sensitive trigger for `ready_gate_out_of_scope` until the fix lands, with the isolation check that distinguishes it.
