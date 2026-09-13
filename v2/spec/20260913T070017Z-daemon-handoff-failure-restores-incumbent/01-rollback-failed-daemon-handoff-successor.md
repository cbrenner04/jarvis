# Roll back a failed daemon handoff — successor signaling

## Problem

The successor has no way to tell the incumbent that startup failed before readiness, and no way to finalize the handoff on success. A bind failure, a stalled wait for the incumbent's listener release, a failed readiness probe, or a thrown startup exception all currently leave the incumbent's handoff transaction unresolved.

## Behavior

The successor carries the handoff identity it received in the incumbent's `changeover` reply through its own startup sequence. On any post-cutoff, pre-readiness failure it requests rollback from the incumbent using that identity. On reaching readiness it requests commit exactly once; after that the incumbent is not asked again.

## Decisions

- Send the rollback request as soon as any post-cutoff pre-readiness failure is detected, using the identity carried since changeover; rules out a startup failure stalling silently with no signal ever sent to the incumbent.
- Send exactly one commit request on reaching readiness, matching the identity received at changeover; rules out the successor advancing ownership without the incumbent recognizing the same generation.

## Task checklist

- [ ] Carry the handoff identity received at changeover through the successor's startup sequence.
- [ ] Request rollback on each post-cutoff pre-readiness failure path: bind failure, release-wait timeout, readiness probe failure, and a thrown startup exception.
- [ ] Request commit on successful readiness.
- [ ] Add focused coverage in `daemon-lifecycle.sandbox-unrunnable.test.ts` for each failure path and for the success path.
- [ ] Align the durable daemon-host documentation with the successor-side identity carry-through and signaling contract.

## Acceptance criteria

- [ ] `v2/src/daemon/daemon-lifecycle.sandbox-unrunnable.test.ts` proves each of these pre-readiness failures requests rollback using the carried handoff identity: successor bind failure, release-wait timeout, readiness probe failure, and a thrown startup exception; it fails against the pre-fix code, which never signals the incumbent on any of these paths.
- [ ] `v2/src/daemon/daemon-lifecycle.sandbox-unrunnable.test.ts` proves successful readiness requests commit exactly once and the incumbent is not asked again afterward.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — define the successor-side identity carry-through and which startup failure paths trigger rollback versus commit.
