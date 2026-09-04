# Notifications CLI wait and list

## Problem

Daemon `notification_wait` and `notification_list` RPCs read the delivery ledger, but no CLI exposes them. Operators hand-roll `tail -f` on sink JSONL, miss boundaries when re-arm is late, and cannot resume from a durable cursor.

## Decision ledger

- Add `jarvis notifications wait` and `jarvis notifications list` subcommands delegating to the daemon RPCs; rules out documenting sink-only push as the only notification surface.
- `notifications wait` blocks on one `notification_wait` IPC call, prints one minified JSON line of `{ incident, deliveryCursor }` on stdout, and exits `0` when the next owed incident arrives; rules out multi-line or streaming stdout on wait and rules out incident-only stdout (blocks `--since` chaining from prior wait output).
- `notifications list` issues one `notification_list` IPC call, prints sink-shaped `incident` objects as NDJSON (one per line) without blocking, and exits `0`; rules out a single JSON array wrapper, human table output, and per-line `deliveryCursor` wrappers.
- `--since` accepts cursor (`deliveredAt:incidentId:transition`), duration, or timestamp and composes with repeatable `--kind` on wait and list; rules out tail line-offset semantics.
- When `--since` is omitted, CLI sends `sinceMs: 0`; rules out requiring explicit `--since` on every invocation and rules out defaulting to "now" (would miss catch-up deliveries).
- `--since` parsing reuses run-list duration/timestamp rules; values that fail those parsers and match `decodeNotificationDeliveryCursor` wire form map to `sinceCursor`; rules out a separate `--cursor` flag.
- Empty `--kind` (zero repetitions) is rejected before IPC with the same `invalid_params` shape as the daemon; rules out treating empty kind as match-nothing.
- `notificationSinkCommand` stays unchanged; wait/list are the pull side of the same ledger, not a sink replacement.
- Notifications wait/list connect via `connectWithAutoStart(deps, deps.socketPath)` / `withConnectDispatch` like other thin daemon CLIs; rules out run-owner socket discovery.
- Co-located CLI tests inject IPC client fakes and drive ledger deliveries through the test store or sweep hooks; rules out live-daemon-only coverage for this slice.
- Deferred to first consumer: `notifications list --follow` long-lived stream behavior — pin when an operator workflow needs streaming catch-up beyond one-shot list.
- Deferred to first consumer: `notifications wait` timeout/bounded block — pin when an operator workflow needs a max wait duration.

## Prerequisites

- Delivery ledger rows persist the serialized incident JSON written to the sink at record time.
- The state store exposes an ordered delivered-incident query filterable by since cursor or timestamp and optional incident kinds.
- The daemon exposes `notification_wait` and `notification_list` RPCs that read the ledger and wake blocked waiters when the sweep records a delivery.

## Task checklist

- Add `notifications` top-level command to the command tree, help flags, usage strings, and `cli.ts` dispatch.
- Implement `notifications wait`: parse `--since` / `--kind`, map to RPC params, block on `notification_wait`, print minified `{ incident, deliveryCursor }` JSON line to stdout, exit `0` on success; pass through RPC/connection errors on stderr exit `1`.
- Implement `notifications list`: parse `--since` / `--kind`, map to RPC params, call `notification_list`, print each `incident` as one NDJSON line, exit `0`; pass through RPC/connection errors on stderr exit `1`.
- Add co-located `notifications.test.ts` (or equivalent under `v2/src/commands/`) with IPC fakes covering the regressions below.

## Acceptance criteria

- [x] `v2/src/commands/notifications.test.ts` test `notifications wait blocks until the next owed incident` arms `jarvis notifications wait`, records an incident after wait begins, and asserts one JSON line on stdout with exit `0`; it fails against the pre-fix missing subcommand.
- [x] `v2/src/commands/notifications.test.ts` test `notifications wait stdout is incident and deliveryCursor wrapper` arms wait, records one incident, and asserts stdout parses as `{ incident, deliveryCursor }` with `deliveryCursor` matching the delivery-cursor wire form; it fails against the pre-fix missing subcommand or incident-only stdout.
- [x] `v2/src/commands/notifications.test.ts` test `notifications wait since cursor returns delivery recorded while no waiter was armed` records a delivery, then arms `jarvis notifications wait --since <prior cursor>`, and asserts the incident is returned rather than lost; it fails against the pre-fix path.
- [x] `v2/src/commands/notifications.test.ts` test `notifications wait kind filter ignores non-matching incidents` arms wait with `--kind`, delivers a non-matching incident then a matching one, and asserts only the matching incident wakes the wait; it fails against the pre-fix unfiltered wait.
- [x] `v2/src/commands/notifications.test.ts` test `notifications list since duration returns prior ledger incidents` seeds delivered incidents and asserts `jarvis notifications list --since <duration>` prints one JSON line per incident without blocking; it fails against the pre-fix missing list subcommand.
- [x] `v2/src/commands/notifications.test.ts` test `notifications list stdout is incident-only NDJSON` seeds delivered incidents and asserts each stdout line parses as a sink-shaped `incident` object with no `deliveryCursor` wrapper; it fails against the pre-fix missing list subcommand or per-line cursor wrappers.
- [x] `v2/src/commands/notifications.test.ts` test `notifications list omitted since returns ledger from start` seeds delivered incidents predating the CLI call and asserts `jarvis notifications list` without `--since` returns them via `sinceMs: 0`; it fails against the pre-fix missing list subcommand or defaulting `--since` to now.
- [x] `v2/src/commands/notifications.test.ts` test `notifications list since cursor returns deliveries after cursor` records multiple deliveries, lists with `--since <prior cursor>`, and asserts only later incidents print; it fails against the pre-fix missing list subcommand or broken cursor CLI→RPC mapping.
- [x] `v2/src/commands/notifications.test.ts` test `notifications list kind filter excludes non-matching incidents` seeds mixed-kind deliveries and asserts `jarvis notifications list --kind <set>` prints only matching incidents as NDJSON; it fails against the pre-fix unfiltered list.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.
- [x] `bun run test:integration:v2` passes.

## Documentation updates

- None in this subspec; operator runbook alignment is subspec 01.
