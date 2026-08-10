# Recover owned ready-gate test groups

## Problem

After daemon loss, recovery must not signal a process group merely because a recorded PID or PGID exists: either identifier may have been reused, and a leader may exit while descendants remain.

## Decision ledger

- Recovery enumerates active ownership records and authorizes a group signal only when the current leader has the recorded positive PID, remains the group leader (`pid === pgid`), and yields the exact canonical `readProcessBirthToken(pid)` value from the same provider used at launch. Rules out PID/PGID reuse and mismatched leaders.
- Missing, unreadable, malformed, sentinel, non-positive, mismatched, or changed identity fails closed: recovery sends no signal and leaves the record for diagnosis. Rules out guessing from liveness or run status.
- A leader-exited group is non-authorizing even if descendants remain. Recovery neither signals that descendant-only group nor clears its record automatically; it reports the unresolved evidence for operator diagnosis. This deliberately narrows automatic recovery to groups whose leader identity remains verifiable.
- After an authorized group settles, recovery compare-and-clears the exact run/fence record. A stale clear is non-success and leaves a newer record unchanged. Rules out restart recovery erasing a retry.
- Recovery does not change run lifecycle status, ready-gate repair state, gate selection, command order, or healthy execution. Rules out conflating process ownership with gate policy.

## Tasks

- Add restart/reconciliation ownership recovery that uses the state-store enumeration API, an injectable canonical process-identity probe, and an injectable process-group signal/join seam.
- Fail closed for every unverifiable record and report unresolved ownership without signaling or clearing it.
- Signal and join only an exactly verified group, then compare-and-clear its exact fence.
- Cover valid recovery, PID/PGID reuse rejection, leader-exit rejection, and stale-clear isolation in `v2/src/daemon/daemon-reconciliation.test.ts`.

## Acceptance criteria

- [ ] This baseline-failing regression proves recovery validates the same canonical leader identity before signaling and joins before exact clearing, and its in-test `// @mutate` that bypasses identity validation makes the scoped suite fail; `v2/src/daemon/daemon-reconciliation.test.ts` — `reaps only a verified owned ready-gate test group after daemon restart`; Keystone checkpoint:
- [ ] This regression proves reused PID/PGID evidence, changed or unavailable birth tokens, malformed identity, and a leader-exited descendant-only group produce no signal and no automatic clear, and its in-test `// @mutate` that signals an unverifiable record makes the scoped suite fail; `v2/src/daemon/daemon-reconciliation.test.ts` — `leaves unverifiable ready-gate test ownership unsignaled`; Mutation checkpoint:
- [ ] This regression replaces the recovered record before settlement and proves recovery's stale compare-and-clear is non-success without removing the newer record, and its in-test `// @mutate` that clears by run alone makes the scoped suite fail; `v2/src/daemon/daemon-reconciliation.test.ts` — `does not clear a newer ready-gate invocation during recovery`; Mutation checkpoint:
- [ ] Restart recovery leaves run lifecycle status and ready-gate repair state unchanged, and `v2/src/execution/ready-finalize.test.ts` — `runs the ready gate then flips the draft PR on green` stays green.
- [ ] `v2/docs/write-behavior.md` and `v2/docs/v1-behaviors.md` document that automatic reaping requires a verifiable live leader and leaves descendant-only groups unresolved.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- Update `v2/docs/write-behavior.md` and `v2/docs/v1-behaviors.md` with restart recovery's verified-leader-only scope and unresolved-record behavior.
