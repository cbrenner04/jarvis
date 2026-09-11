# Legacy keyed-daemon migration

## Problem

The first stable-address generation starts on a machine where a pre-stable daemon is already serving a digest-keyed socket with work admitted. That daemon has no public address and no handoff RPC, so the changeover in [01](./01-handoff-changeover-protocol.md) finds the public address free and would start alongside it — orphaning the older daemon's admitted work exactly as the keyed-coexistence model does today.

## Behavior

When the public address is free but live `daemon-<key>.sock` peers exist, the incoming generation treats each as a legacy outgoing generation: it uses that daemon's existing keyed socket as the private successor-only endpoint, closes its admission through the `supersede` RPC that socket already answers, and drains it over the same channel [02](./02-outgoing-generation-drain-and-exit.md) uses. No legacy-side code change is required.

## Decisions

- Legacy peers are discovered through the existing keyed-socket enumeration and liveness probe rather than a new marker file; rules out requiring the pre-stable daemon to advertise anything it was never built to write.
- Admission cutoff on a legacy peer uses `supersede`, and drain uses `list` — the RPCs the pre-stable socket already answers; rules out a migration that depends on the legacy generation understanding the handoff RPC.
- The incoming generation's own private endpoint is excluded from the legacy peer set; rules out a generation superseding itself.
- A legacy peer that does not answer `supersede` is skipped rather than failing startup; rules out a dead keyed socket file blocking every future daemon start.

## Acceptance criteria

- [ ] A migration test proves a live daemon reachable only on a legacy digest-keyed socket is put into admission cutoff and drained, with its already-admitted run reaching its normal outcome, when the first stable-address generation starts; it fails against the pre-fix shape where the new daemon starts alongside it.
- [ ] A test proves the incoming generation's own private endpoint is never treated as a legacy peer.
- [ ] A test proves an unreachable keyed socket path is skipped and the incoming generation still starts and serves the public address.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.
- [ ] `bun run test:integration:v2` passes.

## Documentation updates

- `v2/docs/daemon-host.md` — legacy keyed-daemon adoption as an outgoing generation and the RPCs it uses.
- `v2/docs/operator-runbook.md` — replace the overlapping-daemons-after-rebuild recovery guidance with the automatic legacy drain.
