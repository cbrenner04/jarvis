# Route draining run unary calls to the direct owner

## Problem

`jarvis run wait` currently discovers a live owner's keyed socket before issuing its request, bypassing the stable daemon, while stable-address `wait`, `pause`, and `kill` consult only successor-local execution state. During handoff, that can produce a premature local wait settlement or `run_not_active` even though the predecessor still owns the invocation.

## Behavior

`jarvis run wait` sends its unary request to the invoking stable address. The stable daemon routes `wait`, `pause`, and `kill` for a direct-predecessor-owned live run to that predecessor's private endpoint, including while ownership observation is initially unresolved or is being revalidated after a cleared snapshot. The predecessor executes the existing handler locally and the stable daemon returns its result or error unchanged. Current-generation and definitively unowned requests stay local.

## Decisions

- Route only `wait`, `pause`, and `kill`; leave `resume`, dismissal, tail streaming, and admission handlers on their existing paths because they do not control a currently executing invocation; rules out broad proxying of unrelated run RPCs.
- Send CLI `wait` to the invoking stable address rather than resolving an owner socket client-side; rules out bypassing stable-front-door routing during a handoff.
- Prefer current-generation active ownership over predecessor ownership; rules out a stale predecessor entry sending control away from the runtime that now owns the run.
- Do not apply successor-local settlement or refusal while a direct predecessor ownership snapshot is initial-empty or transiently cleared: wait for its authoritative refresh, or return the route failure; rules out premature wait settlement and `run_not_active` during observation windows.
- Forward the original method and complete params, including `kill.force`, only to `predecessorSocketPath`, then return the owner's response or application error without a routing envelope; rules out changed RPC contracts, generation metadata, and socket enumeration.
- The direct predecessor executes a forwarded call locally when it owns the run; rules out hop-by-hop forwarding through older generations.
- On owner connection loss, failed ownership refresh, or RPC failure, return an error and do not fall back locally; rules out reporting a successful wait or kill after owner routing fails.
- Each forwarded request owns and closes its private transport on success, application error, connection failure, and caller cancellation; rules out leaked transports and one cancelled wait closing another forwarded wait.

## Tasks

- Route normal CLI waits through the stable daemon rather than cross-daemon owner discovery.
- Add one direct-owner unary routing boundary around the existing local handlers, including ownership-refresh windows and complete RPC parameter/result/error preservation.
- Cover direct-owner, current-owner, no-predecessor, initial-empty, transient-clear, route-loss, cancellation, concurrent waits, and no-chain behavior with focused handler tests.
- Add real-socket stable-address regressions for predecessor-owned wait and kill.
- Align the CLI contract, daemon RPC contract, architecture boundary, and v1 behavior catalog.

## Acceptance criteria

- [x] `v2/src/commands/run.test.ts` proves normal `jarvis run wait` sends one request to the invoking stable address without owner-socket discovery; it fails against the pre-fix `resolveRunOwnerSocket` path.
- [x] `v2/src/daemon/daemon-stable-run-routing.sandbox-unrunnable.test.ts` proves `wait` through the stable address remains pending on a direct predecessor-owned live run and returns that owner's eventual settlement; it fails against the pre-fix successor-local result.
- [x] `v2/src/daemon/daemon-stable-run-routing.sandbox-unrunnable.test.ts` proves `kill --force` through the stable address preserves `force`, aborts, and settles the direct predecessor's live invocation; it fails against the pre-fix `run_not_active` refusal.
- [x] `v2/src/daemon/daemon-stable-run-routing.test.ts` proves an initial-empty and a transiently cleared ownership snapshot each defer local `wait`/control handling until authoritative refresh, then reach the owner; a failed refresh returns an error without local settlement or `run_not_active`; it fails against the pre-fix local fallback.
- [x] `v2/src/daemon/daemon-stable-run-routing.test.ts` proves `pause` uses the same direct-owner route, forwarded owner application errors and all method params return unchanged, and the predecessor handles the call locally; it fails against the pre-fix successor-local `run_not_active` refusal.
- [x] `v2/src/daemon/daemon-stable-run-routing.test.ts` proves every forwarded private transport closes after success, application error, connection failure, or cancellation, and cancelling one of concurrent forwarded waits leaves the other connected until its own settlement; it fails against the pre-fix absence of forwarding ownership.
- [x] `v2/src/daemon/daemon-wire.test.ts` stays green, preserving response envelopes without generation or route metadata.
- [x] `v2/src/daemon/daemon-run-lifecycle-handlers.test.ts` wait, pause, and kill regressions stay green, preserving no private routing transport for current-generation and no-predecessor requests.
- [x] `v2/src/daemon/daemon-private-endpoint-bind.test.ts` stays green, preserving direct-predecessor-only wiring and excluding forwarding chains.
- [x] `v2/src/commands/run.test.ts` wait, pause, and kill result, error, and exit-code regressions stay green.
- [x] `v2/docs/daemon-host.md` documents direct-owner unary routing, ownership-refresh windows, unchanged result/error shapes, route loss, cancellation, and excluded verbs.
- [x] `v2/docs/v2-architecture.md` places stable-front-door unary live-run routing behind the daemon boundary.
- [x] `v2/docs/v1-behaviors.md` records that draining runs remain waitable, pausable, and killable through the stable daemon.
- [x] `v2/docs/write-behavior.md` records that normal `jarvis run wait` targets the stable address rather than resolving a live owner socket.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.
- [x] `bun run test:integration:v2` passes.

## Documentation updates

- `v2/docs/daemon-host.md` — define direct-owner routing for wait, pause, and kill, ownership-refresh windows, unchanged result/error shapes, route loss, cancellation, and excluded verbs.
- `v2/docs/v2-architecture.md` — place unary live-run routing behind the stable daemon boundary.
- `v2/docs/v1-behaviors.md` — record that draining runs remain waitable, pausable, and killable through the stable daemon.
- `v2/docs/write-behavior.md` — define stable-address routing for normal `jarvis run wait`.
