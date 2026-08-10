# Persist active ready-gate test ownership

## Problem

Ready-gate test process groups have no durable run ownership, so a daemon that did not spawn them cannot safely distinguish an active or leaked group from an unrelated reused process identity.

## Decision ledger

- Keep at most one active invocation per run. Registration while any invocation remains active, including a retry or resume, is refused without replacement; only settlement's exact clear makes a later launch admissible. Rules out overwriting a possibly live group.
- Persist the owning run ID, a nonempty opaque launch fence, the positive process-group ID, and a positive group-leader PID equal to that group ID with its canonical OS birth token. Rules out bare or mismatched PID/PGID evidence.
- The only identity source is a platform `readProcessBirthToken(pid)` adapter: it returns a canonical UTF-8 token from immutable kernel process-birth data at native reuse-distinguishing precision, or `null`. Exact byte equality is required; `ps lstart`, a rounded epoch, and any source that cannot provide that token are unavailable, not weaker evidence. Rules out second-resolution timestamps, sentinels, and best-effort authorization.
- Registration requires an existing run and a syntactically valid record. Unknown runs, invalid or unavailable identity, a duplicate fence with different evidence, and another active fence return typed non-success outcomes without mutation; an identical duplicate is idempotent.
- Compare-and-clear matches both run ID and launch fence and returns `cleared`, `not_found`, or `fence_mismatch`; every non-success result preserves the record. Each consumer launch creates a fresh `crypto.randomUUID()` fence and never reuses it across retry or resume.
- Expose ownership records as durable evidence only; launch, current-identity validation, signaling, and leader-exit handling remain in the serial consumer subspecs. Rules out coupling store operations to gate policy.

## Tasks

- Add a forward-only state-store migration for active ready-gate test ownership tied to durable runs.
- Add typed state-store operations to register an admissible invocation, enumerate active records, and compare-and-clear one invocation with explicit non-success outcomes.
- Validate record shape before persistence and retain no authorizing record for invalid, unavailable, non-positive, mismatched, or sentinel process identity.
- Cover round-trip, reopen, upgrade from every pre-change migration, registration conflicts, exact clear, and run-state isolation in `v2/src/persistence/state-store.test.ts`.

## Acceptance criteria

- [ ] The state store admits one valid active ownership record per existing run and enumerates its run ID, fresh launch fence, positive PGID, and matching positive leader PID with canonical birth token; it creates no record for unavailable, blank, sentinel, non-positive, or mismatched identity.
- [ ] This baseline-failing regression proves round-trip persistence and reopen durability, opens a database carrying every pre-change migration, verifies it upgrades and registers/enumerates a record, and contains an in-test `// @mutate` that removes durable registration so the scoped suite fails; `v2/src/persistence/state-store.test.ts` — `persists active ready-gate test ownership across reopen`; Keystone checkpoint:
- [ ] This baseline-failing regression proves unknown runs, invalid identity, a conflicting duplicate fence, and a concurrent retry or resume while another invocation is active all return typed non-success without replacing the active record, and its in-test `// @mutate` that permits replacement makes the scoped suite fail; `v2/src/persistence/state-store.test.ts` — `refuses unsafe ready-gate ownership registrations`; Mutation checkpoint:
- [ ] This regression proves a stale or different fence returns non-success without removing the active record, then the exact fence clears it; its in-test `// @mutate` that weakens the exact-fence predicate makes the scoped suite fail; `v2/src/persistence/state-store.test.ts` — `clears only the matching ready-gate invocation`; Mutation checkpoint:
- [ ] Registering, enumerating, or clearing ownership leaves the owning run's lifecycle status and ready-gate repair fence unchanged.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- None — this is an internal persistence contract; launch and recovery semantics belong to the linked consumer subspecs.
